import {
  buildKafkaConfigFromEnv,
  createIntegrationEventEnvelope,
  createLogger,
  getProducer
} from '@mereb/shared-packages';
import type { MessagingEventPublisherPort } from '../../../application/messaging/ports.js';
import {
  MESSAGING_EVENT_TOPICS,
  type MessagingConversationCreatedEventData,
  type MessagingMessageSentEventData
} from '../../../contracts/messaging-events.js';

type KafkaConfig = NonNullable<ReturnType<typeof buildKafkaConfigFromEnv>>;

const logger = createLogger('svc-messaging-events');

function isEnabled(): boolean {
  return (process.env.MESSAGING_EVENTS_ENABLED ?? 'false') === 'true';
}

class NoopMessagingEventPublisherAdapter implements MessagingEventPublisherPort {
  async publishConversationCreated(): Promise<void> {
    return;
  }
  async publishMessageSent(): Promise<void> {
    return;
  }
}

class KafkaMessagingEventPublisherAdapter implements MessagingEventPublisherPort {
  constructor(private readonly config: KafkaConfig) {}

  async publishConversationCreated(input: {
    conversationId: string;
    participantIds: string[];
  }): Promise<void> {
    await this.publish<MessagingConversationCreatedEventData>({
      topic: MESSAGING_EVENT_TOPICS.conversationCreated,
      eventType: MESSAGING_EVENT_TOPICS.conversationCreated,
      key: input.conversationId,
      data: {
        conversation_id: input.conversationId,
        participant_ids: input.participantIds
      }
    });
  }

  async publishMessageSent(input: {
    messageId: string;
    conversationId: string;
    senderId: string;
  }): Promise<void> {
    await this.publish<MessagingMessageSentEventData>({
      topic: MESSAGING_EVENT_TOPICS.messageSent,
      eventType: MESSAGING_EVENT_TOPICS.messageSent,
      key: input.conversationId,
      data: {
        message_id: input.messageId,
        conversation_id: input.conversationId,
        sender_id: input.senderId
      }
    });
  }

  private async publish<TData>(input: {
    topic: string;
    eventType: string;
    key: string;
    data: TData;
  }): Promise<void> {
    try {
      const producer = await getProducer(this.config);
      const envelope = createIntegrationEventEnvelope({
        eventType: input.eventType,
        producer: 'svc-messaging',
        data: input.data
      });

      await producer.send({
        topic: input.topic,
        messages: [
          {
            key: input.key,
            value: JSON.stringify(envelope)
          }
        ]
      });
    } catch (error) {
      logger.warn(
        {
          err: error,
          topic: input.topic,
          eventType: input.eventType
        },
        'Failed to publish messaging integration event'
      );
    }
  }
}

export function createMessagingEventPublisherAdapter(): MessagingEventPublisherPort {
  if (!isEnabled()) {
    return new NoopMessagingEventPublisherAdapter();
  }

  const config = buildKafkaConfigFromEnv({ clientId: 'svc-messaging' });
  if (!config) {
    logger.warn(
      'MESSAGING_EVENTS_ENABLED=true but Kafka config missing; messaging events disabled'
    );
    return new NoopMessagingEventPublisherAdapter();
  }

  return new KafkaMessagingEventPublisherAdapter(config);
}
