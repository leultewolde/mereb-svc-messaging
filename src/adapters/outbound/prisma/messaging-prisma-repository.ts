import { prisma } from '../../../prisma.js';
import type {
  ConversationRecord,
  MessageConnection,
  MessageRecord,
  MessagingRepositoryPort
} from '../../../application/messaging/ports.js';

type SeedMessage = {
  body: string;
  senderId: string;
  senderName?: string;
  sentAt: Date;
};

type SeedConversation = {
  title: string;
  participantIds: string[];
  unreadCount?: number;
  messages: SeedMessage[];
};

const now = new Date();
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const seedConversations: SeedConversation[] = [
  {
    title: 'Platform Ops',
    participantIds: ['u-platform', 'u-release', 'u-ops'],
    unreadCount: 2,
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
    unreadCount: 0,
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
    unreadCount: 0,
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
  async ensureSeedData(): Promise<void> {
    const count = await prisma.conversation.count();
    if (count > 0) return;

    for (const seed of seedConversations) {
      await prisma.conversation.create({
        data: {
          title: seed.title,
          participantIds: seed.participantIds,
          unreadCount: seed.unreadCount ?? 0,
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
    const rows = await prisma.conversation.findMany({
      where: { participantIds: { has: userId } },
      orderBy: { updatedAt: 'desc' }
    });
    return rows.map(toConversationRecord);
  }

  async findUserConversation(
    id: string,
    userId: string
  ): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findFirst({
      where: { id, participantIds: { has: userId } }
    });
    return row ? toConversationRecord(row) : null;
  }

  async findConversationById(id: string): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findUnique({ where: { id } });
    return row ? toConversationRecord(row) : null;
  }

  async findDirectConversation(
    userId: string,
    otherUserId: string
  ): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findFirst({
      where: {
        participantIds: {
          hasEvery: [userId, otherUserId]
        }
      }
    });
    return row ? toConversationRecord(row) : null;
  }

  async createDirectConversation(input: {
    participantIds: [string, string];
  }): Promise<ConversationRecord> {
    const created = await prisma.conversation.create({
      data: {
        title: 'Direct message',
        participantIds: input.participantIds,
        unreadCount: 0
      }
    });
    return toConversationRecord(created);
  }

  async listMessages(
    conversationId: string,
    after?: string,
    limit = 20
  ): Promise<MessageConnection> {
    const items = await prisma.message.findMany({
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
    const created = await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: input.senderId,
        senderName: input.senderName ?? null,
        body: input.body
      }
    });
    return toMessageRecord(created);
  }

  async touchConversationOnMessage(input: {
    conversationId: string;
    currentUnreadCount: number;
  }): Promise<void> {
    await prisma.conversation.update({
      where: { id: input.conversationId },
      data: {
        updatedAt: new Date(),
        unreadCount: Math.max(0, input.currentUnreadCount - 1)
      }
    });
  }

  async findLatestMessage(conversationId: string): Promise<MessageRecord | null> {
    const latest = await prisma.message.findFirst({
      where: { conversationId },
      orderBy: { sentAt: 'desc' }
    });
    return latest ? toMessageRecord(latest) : null;
  }
}
