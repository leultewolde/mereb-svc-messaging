import {
  buildKafkaConfigFromEnv,
  createLogger,
  initDefaultTelemetry,
  loadEnv
} from '@mereb/shared-packages';
import { startMessagingOutboxRelay } from './bootstrap/outbox-relay.js';

const logger = createLogger('svc-messaging-outbox-worker');

function waitForShutdown(stop: () => void): Promise<void> {
  return new Promise((resolve) => {
    let stopping = false;
    const handleSignal = (signal: NodeJS.Signals) => {
      if (stopping) {
        return;
      }
      stopping = true;
      logger.info({ signal }, 'Shutting down messaging outbox relay worker');
      stop();
      resolve();
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
  });
}

loadEnv();
initDefaultTelemetry('svc-messaging-outbox-relay');

if ((process.env.MESSAGING_EVENTS_ENABLED ?? 'false') !== 'true') {
  logger.error('MESSAGING_EVENTS_ENABLED must be true for outbox relay worker');
  process.exit(1);
}

if ((process.env.MESSAGING_OUTBOX_RELAY_ENABLED ?? 'true') !== 'true') {
  logger.error('MESSAGING_OUTBOX_RELAY_ENABLED=false; dedicated outbox relay worker will not start');
  process.exit(1);
}

if (!buildKafkaConfigFromEnv({ clientId: 'svc-messaging-outbox-relay' })) {
  logger.error('Kafka config missing; cannot start messaging outbox relay worker');
  process.exit(1);
}

try {
  const stop = startMessagingOutboxRelay({ unrefTimer: false });
  logger.info('Messaging outbox relay worker started');
  await waitForShutdown(stop);
} catch (error) {
  logger.error({ err: error }, 'Failed to start messaging outbox relay worker');
  process.exit(1);
}
