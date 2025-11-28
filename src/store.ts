import type { GraphQLContext } from './context.js'
import { prisma } from './prisma.js'

type SeedMessage = {
  body: string
  senderId: string
  senderName?: string
  sentAt: Date
}

type SeedConversation = {
  title: string
  participantIds: string[]
  unreadCount?: number
  messages: SeedMessage[]
}

const now = new Date()
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

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
]

export async function ensureSeedData() {
  const count = await prisma.conversation.count()
  if (count > 0) return

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
    })
  }
}

export async function listConversations() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { sentAt: 'desc' },
        take: 1
      }
    }
  })
  return conversations.map((conversation) => ({
    ...conversation,
    lastMessage: conversation.messages[0] ?? null,
    messages: undefined
  }))
}

export async function findConversation(id: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { sentAt: 'desc' },
        take: 1
      }
    }
  })
  if (!conversation) return null
  return { ...conversation, lastMessage: conversation.messages[0] ?? null, messages: undefined }
}

export async function listMessages(conversationId: string, after?: string, limit = 20) {
  const items = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { sentAt: 'desc' },
    cursor: after ? { id: after } : undefined,
    skip: after ? 1 : 0,
    take: limit + 1
  })

  const nodes = items.slice(0, limit)
  const edges = nodes.map((message) => ({ node: message, cursor: message.id }))
  const hasNextPage = items.length > limit

  return {
    edges,
    pageInfo: {
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
      hasNextPage
    }
  }
}

export async function addMessage(
  conversationId: string | undefined,
  body: string,
  ctx: GraphQLContext,
  toUserId?: string
) {
  if (!ctx.userId) {
    throw new Error('Authentication required to send messages')
  }

  let targetConversationId = conversationId

  if (!targetConversationId) {
    if (!toUserId) throw new Error('toUserId is required when conversationId is not provided')

    const existing = await prisma.conversation.findFirst({
      where: {
        participantIds: {
          hasEvery: [ctx.userId, toUserId]
        }
      }
    })

    if (existing) {
      targetConversationId = existing.id
    } else {
      const created = await prisma.conversation.create({
        data: {
          title: 'Direct message',
          participantIds: [ctx.userId, toUserId],
          unreadCount: 0
        }
      })
      targetConversationId = created.id
    }
  }

  const conversation = await prisma.conversation.findUnique({ where: { id: targetConversationId } })
  if (!conversation) {
    throw new Error('Conversation not found')
  }

  const message = await prisma.message.create({
    data: {
      conversationId: targetConversationId,
      senderId: ctx.userId,
      senderName: 'You',
      body
    }
  })

  await prisma.conversation.update({
    where: { id: targetConversationId },
    data: {
      updatedAt: new Date(),
      unreadCount: Math.max(0, conversation.unreadCount - 1)
    }
  })

  return message
}
