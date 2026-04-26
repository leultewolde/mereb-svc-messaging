import {
  buildKafkaConfigFromEnv,
  createIntegrationEventEnvelope,
  createKafkaIntegrationEventPublisher,
  createLogger,
  flushOutboxOnce,
  readOutboxEnvConfig,
  startOutboxRelay,
  type IntegrationEventEnvelope,
  type IntegrationEventPublisher,
  type OutboxRelayMetrics,
  type OutboxRelayPublisher
} from '@mereb/shared-packages';
import {
  PrismaMessagingOutboxRelayStore,
  type PendingMessagingOutboxEvent
} from '../adapters/outbound/prisma/messaging-prisma-repository.js';
import {
  recordMessagingOutboxFlushMetrics,
  setMessagingOutboxQueueDepth
} from './outbox-metrics.js';

const logger = createLogger('svc-messaging-outbox-relay');

export interface MessagingOutboxRelayStartOptions {
  unrefTimer?: boolean;
  intervalMs?: number;
}

export interface MessagingOutboxFlushOptions {
  limit?: number;
  store?: PrismaMessagingOutboxRelayStore;
  publisher?: IntegrationEventPublisher;
}

function resolveDlqTopic(topic: string): string {
  return process.env.MESSAGING_OUTBOX_DLQ_TOPIC ?? `${topic}.dlq`;
}

function buildPublisher(
  envelopePublisher: IntegrationEventPublisher,
  dlqEnabled: boolean
): OutboxRelayPublisher<PendingMessagingOutboxEvent> {
  let dlqPublisher: IntegrationEventPublisher | null = null;
  function getDlqPublisher(): IntegrationEventPublisher | null {
    if (dlqPublisher) return dlqPublisher;
    const config = buildKafkaConfigFromEnv({ clientId: 'svc-messaging-outbox-relay-dlq' });
    if (!config) return null;
    dlqPublisher = createKafkaIntegrationEventPublisher(config);
    return dlqPublisher;
  }
  return {
    async publish(event) {
      await envelopePublisher.publish(
        event.topic,
        event.envelope as IntegrationEventEnvelope<unknown>,
        { key: event.eventKey ?? undefined }
      );
    },
    async publishDeadLetter(event, error) {
      if (!dlqEnabled) {
        return { deadLetterTopic: null };
      }
      const publisher = getDlqPublisher();
      if (!publisher) {
        logger.warn(
          { outboxId: event.id, topic: event.topic, eventType: event.eventType },
          'Kafka config missing for messaging DLQ publish; skipping DLQ publish'
        );
        return { deadLetterTopic: null };
      }
      const dlqTopic = resolveDlqTopic(event.topic);
      const dlqEnvelope = createIntegrationEventEnvelope({
        eventType: `${event.eventType}.dead_lettered`,
        producer: 'svc-messaging-outbox-relay',
        data: {
          outbox_id: event.id,
          original_topic: event.topic,
          original_event_type: event.eventType,
          original_event_key: event.eventKey,
          attempts: error.attempts,
          error: error.message,
          failed_at: new Date().toISOString(),
          envelope: event.envelope
        }
      });
      await publisher.publish(dlqTopic, dlqEnvelope, {
        key: event.eventKey ?? event.id
      });
      return { deadLetterTopic: dlqTopic };
    }
  };
}

const metrics: OutboxRelayMetrics = {
  refreshQueueDepth: (counts) => setMessagingOutboxQueueDepth(counts),
  recordFlush: (summary) => recordMessagingOutboxFlushMetrics(summary)
};

export async function flushMessagingOutboxOnce(
  input: MessagingOutboxFlushOptions = {}
): Promise<void> {
  const config = readOutboxEnvConfig({
    prefix: 'MESSAGING',
    eventsEnabledFlag: 'MESSAGING_EVENTS_ENABLED'
  });
  const store = input.store ?? new PrismaMessagingOutboxRelayStore();
  const envelopePublisher =
    input.publisher ??
    (() => {
      const kafkaConfig = buildKafkaConfigFromEnv({ clientId: 'svc-messaging-outbox-relay' });
      if (!kafkaConfig) {
        if (config.enabled) {
          logger.warn('Messaging outbox relay enabled but Kafka config is missing; skipping flush');
        }
        return null;
      }
      return createKafkaIntegrationEventPublisher(kafkaConfig);
    })();
  if (!envelopePublisher) {
    return;
  }
  const publisher = buildPublisher(envelopePublisher, config.dlqEnabled);
  await flushOutboxOnce({
    config: { ...config, batchSize: input.limit ?? 50 },
    store,
    publisher,
    logger,
    metrics
  });
}

export function startMessagingOutboxRelay(
  options: MessagingOutboxRelayStartOptions = {}
): () => void {
  const config = readOutboxEnvConfig({
    prefix: 'MESSAGING',
    eventsEnabledFlag: 'MESSAGING_EVENTS_ENABLED'
  });
  if (!config.enabled) {
    return () => {};
  }
  const kafkaConfig = buildKafkaConfigFromEnv({ clientId: 'svc-messaging-outbox-relay' });
  if (!kafkaConfig) {
    logger.warn('Messaging outbox relay enabled but Kafka config is missing; relay disabled');
    return () => {};
  }
  const envelopePublisher = createKafkaIntegrationEventPublisher(kafkaConfig);
  const publisher = buildPublisher(envelopePublisher, config.dlqEnabled);
  return startOutboxRelay({
    config: {
      ...config,
      intervalMs: options.intervalMs ?? config.intervalMs
    },
    store: new PrismaMessagingOutboxRelayStore(),
    publisher,
    logger,
    metrics,
    options: { unrefTimer: options.unrefTimer }
  });
}
