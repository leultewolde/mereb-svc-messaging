import {
  createIntegrationEventEnvelope,
  type IntegrationEventEnvelope
} from '@mereb/shared-packages';
import { prisma } from '../../../prisma.js';
import type {
  ConversationRecord,
  MessageConnection,
  MessageRecord,
  MessagingEventPublisherPort,
  MessagingMutationPorts,
  MessagingRepositoryPort,
  MessagingTransactionPort
} from '../../../application/messaging/ports.js';
import { MESSAGING_EVENT_TOPICS } from '../../../contracts/messaging-events.js';
import {
  OutboxEventStatus,
  type Prisma,
  type PrismaClient
} from '../../../../generated/client/index.js';

type MessagingPrismaDb = PrismaClient | Prisma.TransactionClient;

type SeedMessage = {
  body: string;
  senderId: string;
  senderName?: string;
  sentAt: Date;
};

type SeedConversation = {
  title: string;
  participantIds: string[];
  messages: SeedMessage[];
};

const now = new Date();
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const seedConversations: SeedConversation[] = [
  {
    title: 'Platform Ops',
    participantIds: ['u-platform', 'u-release', 'u-ops'],
    messages: [
      {
        body: 'Deploy to staging completed. Monitoring error rates for 15 minutes.',
        senderId: 'u-platform',
        senderName: 'Platform Bot',
        sentAt: minutesAgo(12)
      },
      {
        body: 'Copy that. Will queue prod promotion after smoke.',
        senderId: 'u-release',
        senderName: 'Release Manager',
        sentAt: minutesAgo(5)
      }
    ]
  },
  {
    title: 'Support triage',
    participantIds: ['u-support', 'u-oncall', 'u-platform'],
    messages: [
      {
        body: 'Ticket #1482 escalated to on-call. Latency spikes on profile reads.',
        senderId: 'u-support',
        senderName: 'Support',
        sentAt: minutesAgo(45)
      },
      {
        body: 'Acknowledged. Looking at the router dashboards now.',
        senderId: 'u-oncall',
        senderName: 'On-call',
        sentAt: minutesAgo(22)
      }
    ]
  },
  {
    title: 'Design x Messaging',
    participantIds: ['u-design', 'u-product', 'u-messaging'],
    messages: [
      {
        body: 'Uploading the empty state illustrations in Figma now.',
        senderId: 'u-design',
        senderName: 'Design',
        sentAt: minutesAgo(155)
      }
    ]
  }
];

function toConversationRecord(input: {
  id: string;
  title: string;
  participantIds: string[];
  unreadCount: number;
  updatedAt: Date;
  createdAt: Date;
}): ConversationRecord {
  return {
    id: input.id,
    title: input.title,
    participantIds: input.participantIds,
    unreadCount: input.unreadCount,
    updatedAt: input.updatedAt,
    createdAt: input.createdAt
  };
}

function latestMessageTimestamp(messages: ReadonlyArray<SeedMessage>): Date | null {
  if (messages.length === 0) {
    return null;
  }

  return [...messages]
    .sort((left, right) => right.sentAt.getTime() - left.sentAt.getTime())[0]
    ?.sentAt ?? null;
}

function resolveUnreadCount(
  states: Array<{ unreadCount: number }> | undefined,
  fallback = 0
): number {
  return states?.[0]?.unreadCount ?? fallback;
}

function toMessageRecord(input: {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string | null;
  body: string;
  sentAt: Date;
}): MessageRecord {
  return {
    id: input.id,
    conversationId: input.conversationId,
    senderId: input.senderId,
    senderName: input.senderName,
    body: input.body,
    sentAt: input.sentAt
  };
}

export class PrismaMessagingRepository implements MessagingRepositoryPort {
  constructor(private readonly db: MessagingPrismaDb = prisma) {}

  async ensureSeedData(): Promise<void> {
    const count = await this.db.conversation.count();
    if (count > 0) return;

    for (const seed of seedConversations) {
      await this.db.conversation.create({
        data: {
          title: seed.title,
          participantIds: seed.participantIds,
          unreadCount: 0,
          participantStates: {
            create: seed.participantIds.map((participantId) => ({
              userId: participantId,
              unreadCount: 0,
              lastReadAt: latestMessageTimestamp(seed.messages)
            }))
          },
          messages: {
            create: seed.messages.map((message) => ({
              body: message.body,
              senderId: message.senderId,
              senderName: message.senderName,
              sentAt: message.sentAt
            }))
          }
        }
      });
    }
  }

  async listUserConversations(userId: string): Promise<ConversationRecord[]> {
    const rows = await this.db.conversation.findMany({
      where: { participantIds: { has: userId } },
      include: {
        participantStates: {
          where: { userId },
          take: 1
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
    return rows.map((row) =>
      toConversationRecord({
        ...row,
        unreadCount: resolveUnreadCount(row.participantStates)
      })
    );
  }

  async findUserConversation(
    id: string,
    userId: string
  ): Promise<ConversationRecord | null> {
    const row = await this.db.conversation.findFirst({
      where: { id, participantIds: { has: userId } },
      include: {
        participantStates: {
          where: { userId },
          take: 1
        }
      }
    });
    return row
      ? toConversationRecord({
          ...row,
          unreadCount: resolveUnreadCount(row.participantStates)
        })
      : null;
  }

  async findConversationById(id: string): Promise<ConversationRecord | null> {
    const row = await this.db.conversation.findUnique({ where: { id } });
    return row ? toConversationRecord(row) : null;
  }

  async findDirectConversation(
    userId: string,
    otherUserId: string
  ): Promise<ConversationRecord | null> {
    const row = await this.db.conversation.findFirst({
      where: {
        participantIds: {
          hasEvery: [userId, otherUserId]
        }
      },
      include: {
        participantStates: {
          where: { userId },
          take: 1
        }
      }
    });
    return row
      ? toConversationRecord({
          ...row,
          unreadCount: resolveUnreadCount(row.participantStates)
        })
      : null;
  }

  async createDirectConversation(input: {
    participantIds: [string, string];
  }): Promise<ConversationRecord> {
    const created = await this.db.conversation.create({
      data: {
        title: 'Direct message',
        participantIds: input.participantIds,
        unreadCount: 0,
        participantStates: {
          create: input.participantIds.map((participantId) => ({
            userId: participantId,
            unreadCount: 0
          }))
        }
      }
    });
    return toConversationRecord(created);
  }

  async listMessages(
    conversationId: string,
    after?: string,
    limit = 20
  ): Promise<MessageConnection> {
    const items = await this.db.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'desc' },
      cursor: after ? { id: after } : undefined,
      skip: after ? 1 : 0,
      take: limit + 1
    });

    const nodes = items.slice(0, limit).map(toMessageRecord);
    const edges = nodes.map((message) => ({
      node: message,
      cursor: message.id
    }));
    const hasNextPage = items.length > limit;

    return {
      edges,
      pageInfo: {
        endCursor: edges.length ? edges[edges.length - 1]?.cursor ?? null : null,
        hasNextPage
      }
    };
  }

  async createMessage(input: {
    conversationId: string;
    senderId: string;
    senderName?: string | null;
    body: string;
  }): Promise<MessageRecord> {
    const created = await this.db.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: input.senderId,
        senderName: input.senderName ?? null,
        body: input.body
      }
    });
    return toMessageRecord(created);
  }

  async recordMessageSent(input: {
    conversationId: string;
    participantIds: string[];
    senderId: string;
    sentAt: Date;
  }): Promise<void> {
    await this.db.conversation.update({
      where: { id: input.conversationId },
      data: {
        updatedAt: input.sentAt
      }
    });

    for (const participantId of input.participantIds) {
      if (participantId === input.senderId) {
        await this.db.conversationParticipantState.upsert({
          where: {
            conversationId_userId: {
              conversationId: input.conversationId,
              userId: participantId
            }
          },
          create: {
            conversationId: input.conversationId,
            userId: participantId,
            unreadCount: 0,
            lastReadAt: input.sentAt
          },
          update: {
            unreadCount: 0,
            lastReadAt: input.sentAt
          }
        });
        continue;
      }

      await this.db.conversationParticipantState.upsert({
        where: {
          conversationId_userId: {
            conversationId: input.conversationId,
            userId: participantId
          }
        },
        create: {
          conversationId: input.conversationId,
          userId: participantId,
          unreadCount: 1,
          lastReadAt: null
        },
        update: {
          unreadCount: {
            increment: 1
          }
        }
      });
    }
  }

  async markConversationRead(input: {
    conversationId: string;
    userId: string;
  }): Promise<void> {
    const latest = await this.db.message.findFirst({
      where: { conversationId: input.conversationId },
      orderBy: { sentAt: 'desc' }
    });

    await this.db.conversationParticipantState.upsert({
      where: {
        conversationId_userId: {
          conversationId: input.conversationId,
          userId: input.userId
        }
      },
      create: {
        conversationId: input.conversationId,
        userId: input.userId,
        unreadCount: 0,
        lastReadAt: latest?.sentAt ?? null
      },
      update: {
        unreadCount: 0,
        lastReadAt: latest?.sentAt ?? null
      }
    });
  }

  async findLatestMessage(conversationId: string): Promise<MessageRecord | null> {
    const latest = await this.db.message.findFirst({
      where: { conversationId },
      orderBy: { sentAt: 'desc' }
    });
    return latest ? toMessageRecord(latest) : null;
  }
}

export class PrismaMessagingOutboxEventPublisher implements MessagingEventPublisherPort {
  constructor(private readonly db: MessagingPrismaDb = prisma) {}

  async publishConversationCreated(input: {
    conversationId: string;
    participantIds: string[];
  }): Promise<void> {
    const envelope = createIntegrationEventEnvelope({
      eventType: MESSAGING_EVENT_TOPICS.conversationCreated,
      producer: 'svc-messaging',
      data: {
        conversation_id: input.conversationId,
        participant_ids: input.participantIds
      }
    });

    await this.createOutboxEvent(
      envelope.event_id,
      MESSAGING_EVENT_TOPICS.conversationCreated,
      input.conversationId,
      envelope
    );
  }

  async publishMessageSent(input: {
    messageId: string;
    conversationId: string;
    senderId: string;
    recipientIds: string[];
  }): Promise<void> {
    const envelope = createIntegrationEventEnvelope({
      eventType: MESSAGING_EVENT_TOPICS.messageSent,
      producer: 'svc-messaging',
      data: {
        message_id: input.messageId,
        conversation_id: input.conversationId,
        sender_id: input.senderId,
        recipient_ids: input.recipientIds
      }
    });

    await this.createOutboxEvent(
      envelope.event_id,
      MESSAGING_EVENT_TOPICS.messageSent,
      input.conversationId,
      envelope
    );
  }

  private async createOutboxEvent(
    id: string,
    topic: string,
    eventKey: string,
    envelope: IntegrationEventEnvelope<unknown>
  ): Promise<void> {
    await this.db.outboxEvent.create({
      data: {
        id,
        topic,
        eventType: envelope.event_type,
        eventKey,
        payload: envelope as unknown as Prisma.InputJsonValue,
        status: OutboxEventStatus.PENDING
      }
    });
  }
}

export interface PendingMessagingOutboxEvent {
  id: string;
  topic: string;
  eventType: string;
  eventKey: string | null;
  envelope: IntegrationEventEnvelope<unknown>;
  attempts: number;
}

export interface MessagingOutboxStatusCounts {
  pending: number;
  processing: number;
  published: number;
  failed: number;
  deadLetter: number;
}

export class PrismaMessagingOutboxRelayStore {
  constructor(private readonly db: MessagingPrismaDb = prisma) {}

  async listDue(limit: number, now = new Date()): Promise<PendingMessagingOutboxEvent[]> {
    const rows = await this.db.outboxEvent.findMany({
      where: {
        status: { in: [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED] },
        nextAttemptAt: { lte: now }
      },
      orderBy: [{ createdAt: 'asc' }],
      take: limit
    });

    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      eventType: row.eventType,
      eventKey: row.eventKey,
      envelope: row.payload as unknown as IntegrationEventEnvelope<unknown>,
      attempts: row.attempts
    }));
  }

  async claim(id: string): Promise<boolean> {
    const result = await this.db.outboxEvent.updateMany({
      where: {
        id,
        status: { in: [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED] }
      },
      data: {
        status: OutboxEventStatus.PROCESSING,
        attempts: { increment: 1 },
        lastError: null
      }
    });

    return result.count > 0;
  }

  async markPublished(id: string, publishedAt = new Date()): Promise<void> {
    await this.db.outboxEvent.updateMany({
      where: { id },
      data: {
        status: OutboxEventStatus.PUBLISHED,
        publishedAt,
        lastError: null
      }
    });
  }

  async markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.db.outboxEvent.updateMany({
      where: { id },
      data: {
        status: OutboxEventStatus.FAILED,
        lastError: error.slice(0, 4000),
        nextAttemptAt,
        publishedAt: null,
        deadLetteredAt: null,
        deadLetterTopic: null
      }
    });
  }

  async markDeadLetter(
    id: string,
    error: string,
    input?: { deadLetteredAt?: Date; deadLetterTopic?: string | null }
  ): Promise<void> {
    await this.db.outboxEvent.updateMany({
      where: { id },
      data: {
        status: OutboxEventStatus.DEAD_LETTER,
        lastError: error.slice(0, 4000),
        deadLetteredAt: input?.deadLetteredAt ?? new Date(),
        deadLetterTopic: input?.deadLetterTopic ?? null,
        publishedAt: null
      }
    });
  }

  async countByStatus(): Promise<MessagingOutboxStatusCounts> {
    const rows = await this.db.outboxEvent.groupBy({
      by: ['status'],
      _count: { _all: true }
    });

    const counts: MessagingOutboxStatusCounts = {
      pending: 0,
      processing: 0,
      published: 0,
      failed: 0,
      deadLetter: 0
    };

    for (const row of rows) {
      switch (row.status) {
        case OutboxEventStatus.PENDING:
          counts.pending = row._count._all;
          break;
        case OutboxEventStatus.PROCESSING:
          counts.processing = row._count._all;
          break;
        case OutboxEventStatus.PUBLISHED:
          counts.published = row._count._all;
          break;
        case OutboxEventStatus.FAILED:
          counts.failed = row._count._all;
          break;
        case OutboxEventStatus.DEAD_LETTER:
          counts.deadLetter = row._count._all;
          break;
        default:
          break;
      }
    }

    return counts;
  }
}

export class PrismaMessagingTransactionRunner implements MessagingTransactionPort {
  constructor(private readonly db: PrismaClient = prisma) {}

  async run<T>(callback: (ports: MessagingMutationPorts) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) =>
      callback({
        repository: new PrismaMessagingRepository(tx),
        eventPublisher: new PrismaMessagingOutboxEventPublisher(tx)
      })
    );
  }
}
