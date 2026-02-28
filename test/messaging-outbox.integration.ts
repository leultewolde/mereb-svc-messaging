import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '../generated/client/index.js';
import { createMessagingApplicationModule } from '../src/application/messaging/use-cases.js';
import {
  PrismaMessagingOutboxRelayStore,
  PrismaMessagingRepository,
  PrismaMessagingTransactionRunner
} from '../src/adapters/outbound/prisma/messaging-prisma-repository.js';
import { MESSAGING_EVENT_TOPICS } from '../src/contracts/messaging-events.js';
import { flushMessagingOutboxOnce } from '../src/bootstrap/outbox-relay.js';
import {
  ensureKafkaTopicExists,
  createSocketForwardKafkaPublisher,
  createTemporarySchemaName,
  dropSchema,
  installDnsOverride,
  provisionSchema,
  runPrismaMigrateDeploy,
  waitForKafkaMessage,
  withSchema
} from '../../../scripts/test-support/db-kafka-integration.mjs';

test('sendMessage writes to outbox and publishes to Kafka', { timeout: 30_000 }, async () => {
  const adminUrl =
    process.env.MESSAGING_INTEGRATION_DATABASE_ADMIN_URL ??
    'postgresql://postgres:postgres@localhost:5432/mereb-db?schema=public';
  const baseServiceUrl =
    process.env.MESSAGING_INTEGRATION_DATABASE_URL ??
    'postgresql://svc_messaging_rw:svc_messaging_rw@localhost:5432/mereb-db?schema=svc_messaging';
  const schemaOwner = process.env.MESSAGING_INTEGRATION_SCHEMA_OWNER ?? 'svc_messaging_rw';
  const brokers = (
    process.env.MESSAGING_INTEGRATION_KAFKA_BROKERS ??
    process.env.KAFKA_BROKERS ??
    'localhost:9092'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const schema = createTemporarySchemaName('svc_messaging_it');
  const databaseUrl = withSchema(baseServiceUrl, schema);
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let prisma: PrismaClient | null = null;
  let publisherHandle:
    | Awaited<ReturnType<typeof createSocketForwardKafkaPublisher>>
    | null = null;
  const restoreDns = installDnsOverride(
    brokers.map((broker) => broker.split(':')[0] ?? broker)
  );
  const useRpkConsumer = Boolean(
    process.env.KAFKA_RPK_NAMESPACE &&
      process.env.KAFKA_RPK_POD &&
      process.env.KAFKA_RPK_BROKER
  );

  const previousKafkaBrokers = process.env.KAFKA_BROKERS;
  const previousKafkaSsl = process.env.KAFKA_SSL;
  const previousKafkaPortForwardHost = process.env.KAFKA_PORT_FORWARD_HOST;
  const previousKafkaPortForwardPort = process.env.KAFKA_PORT_FORWARD_PORT;

  try {
    await provisionSchema(admin, { schema, ownerRole: schemaOwner });
    await runPrismaMigrateDeploy({
      serviceDir: 'services/svc-messaging',
      databaseUrl
    });

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const repository = new PrismaMessagingRepository(prisma);
    const transactionRunner = new PrismaMessagingTransactionRunner(prisma);
    const messaging = createMessagingApplicationModule({
      repository,
      transactionRunner
    });

    const conversation = await prisma.conversation.create({
      data: {
        title: 'Integration thread',
        participantIds: ['u1', 'u2'],
        unreadCount: 0
      }
    });

    let expectedConversationId = conversation.id;
    delete process.env.KAFKA_PORT_FORWARD_HOST;
    delete process.env.KAFKA_PORT_FORWARD_PORT;
    const consumeMessage = useRpkConsumer
      ? null
      : waitForKafkaMessage({
          brokers,
          topic: MESSAGING_EVENT_TOPICS.messageSent,
          groupId: `svc-messaging-it-${schema}`,
          predicate: ({ value }) => {
            const parsed = JSON.parse(value) as { data?: { conversation_id?: string } };
            return parsed.data?.conversation_id === expectedConversationId;
          }
        });

    const sent = await messaging.commands.sendMessage.execute(
      {
        conversationId: conversation.id,
        body: 'hello from integration'
      },
      { principal: { userId: 'u1' } }
    );

    assert.equal(sent.conversationId, conversation.id);

    const store = new PrismaMessagingOutboxRelayStore(prisma);
    const pendingBefore = await store.listDue(10);
    assert.equal(pendingBefore.length, 1);

    await ensureKafkaTopicExists(MESSAGING_EVENT_TOPICS.messageSent);
    publisherHandle = await createSocketForwardKafkaPublisher({
      brokers,
      clientId: `svc-messaging-it-publisher-${schema}`,
      forwardHost: '127.0.0.1',
      forwardPort: 19092,
      sslInsecure: true
    });

    await flushMessagingOutboxOnce({
      limit: 10,
      store,
      publisher: publisherHandle.publisher
    });
    const message = useRpkConsumer
      ? await waitForKafkaMessage({
          brokers,
          topic: MESSAGING_EVENT_TOPICS.messageSent,
          groupId: `svc-messaging-it-${schema}`,
          predicate: ({ value }) => {
            const parsed = JSON.parse(value) as { data?: { conversation_id?: string } };
            return parsed.data?.conversation_id === expectedConversationId;
          }
        })
      : await consumeMessage;
    const envelope = JSON.parse(message.value) as {
      event_type: string;
      data: { conversation_id: string; message_id: string };
    };

    assert.equal(envelope.event_type, MESSAGING_EVENT_TOPICS.messageSent);
    assert.equal(envelope.data.conversation_id, expectedConversationId);
    assert.equal(envelope.data.message_id, sent.id);

    const row = await prisma.outboxEvent.findUnique({
      where: { id: pendingBefore[0]?.id ?? '' }
    });
    assert.equal(row?.status, 'PUBLISHED');
  } finally {
    if (previousKafkaBrokers === undefined) {
      delete process.env.KAFKA_BROKERS;
    } else {
      process.env.KAFKA_BROKERS = previousKafkaBrokers;
    }

    if (previousKafkaSsl === undefined) {
      delete process.env.KAFKA_SSL;
    } else {
      process.env.KAFKA_SSL = previousKafkaSsl;
    }

    if (previousKafkaPortForwardHost === undefined) {
      delete process.env.KAFKA_PORT_FORWARD_HOST;
    } else {
      process.env.KAFKA_PORT_FORWARD_HOST = previousKafkaPortForwardHost;
    }

    if (previousKafkaPortForwardPort === undefined) {
      delete process.env.KAFKA_PORT_FORWARD_PORT;
    } else {
      process.env.KAFKA_PORT_FORWARD_PORT = previousKafkaPortForwardPort;
    }

    if (prisma) {
      await prisma.$disconnect();
    }
    if (publisherHandle) {
      await publisherHandle.disconnect();
    }
    await dropSchema(admin, schema);
    await admin.$disconnect();
    restoreDns();
  }
});
