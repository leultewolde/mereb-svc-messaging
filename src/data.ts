import type { GraphQLContext } from './context.js'

export type MessageRecord = {
  id: string
  conversationId: string
  senderId: string
  senderName?: string
  body: string
  sentAt: string
}

export type ConversationRecord = {
  id: string
  title: string
  participantIds: string[]
  updatedAt: string
  unreadCount: number
  messages: MessageRecord[]
}

const now = new Date()
const isoMinutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

const seedConversations: ConversationRecord[] = [
  {
    id: 'conv-1',
    title: 'Platform Ops',
    participantIds: ['u-platform', 'u-release', 'u-ops'],
    updatedAt: isoMinutesAgo(5),
    unreadCount: 2,
    messages: [
      {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'u-platform',
        senderName: 'Platform Bot',
        body: 'Deploy to staging completed. Monitoring error rates for 15 minutes.',
        sentAt: isoMinutesAgo(12)
      },
      {
        id: 'msg-2',
        conversationId: 'conv-1',
        senderId: 'u-release',
        senderName: 'Release Manager',
        body: 'Copy that. Will queue prod promotion after smoke.',
        sentAt: isoMinutesAgo(5)
      }
    ]
  },
  {
    id: 'conv-2',
    title: 'Support triage',
    participantIds: ['u-support', 'u-oncall', 'u-platform'],
    updatedAt: isoMinutesAgo(22),
    unreadCount: 0,
    messages: [
      {
        id: 'msg-3',
        conversationId: 'conv-2',
        senderId: 'u-support',
        senderName: 'Support',
        body: 'Ticket #1482 escalated to on-call. Latency spikes on profile reads.',
        sentAt: isoMinutesAgo(45)
      },
      {
        id: 'msg-4',
        conversationId: 'conv-2',
        senderId: 'u-oncall',
        senderName: 'On-call',
        body: 'Acknowledged. Looking at the router dashboards now.',
        sentAt: isoMinutesAgo(22)
      }
    ]
  },
  {
    id: 'conv-3',
    title: 'Design x Messaging',
    participantIds: ['u-design', 'u-product', 'u-messaging'],
    updatedAt: isoMinutesAgo(120),
    unreadCount: 0,
    messages: [
      {
        id: 'msg-5',
        conversationId: 'conv-3',
        senderId: 'u-design',
        senderName: 'Design',
        body: 'Uploading the empty state illustrations in Figma now.',
        sentAt: isoMinutesAgo(155)
      }
    ]
  }
]

let conversations: ConversationRecord[] = seedConversations

function nextId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

export function listConversations(): ConversationRecord[] {
  return conversations
    .map((conversation) => ({
      ...conversation,
      messages: [...conversation.messages].sort((a, b) => (a.sentAt > b.sentAt ? -1 : 1))
    }))
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
}

export function findConversation(id: string): ConversationRecord | undefined {
  return listConversations().find((conversation) => conversation.id === id)
}

export function listMessages(conversationId: string, after?: string, limit = 20) {
  const conversation = findConversation(conversationId)
  if (!conversation) return { edges: [], pageInfo: { endCursor: null as string | null, hasNextPage: false } }

  const sorted = [...conversation.messages].sort((a, b) => (a.sentAt > b.sentAt ? -1 : 1))
  let startIndex = 0
  if (after) {
    const cursorIndex = sorted.findIndex((message) => message.id === after)
    startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0
  }

  const slice = sorted.slice(startIndex, startIndex + limit)
  const edges = slice.map((message) => ({ node: message, cursor: message.id }))

  return {
    edges,
    pageInfo: {
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
      hasNextPage: startIndex + limit < sorted.length
    }
  }
}

export function addMessage(conversationId: string, body: string, ctx: GraphQLContext) {
  const conversationIndex = conversations.findIndex((conversation) => conversation.id === conversationId)
  if (conversationIndex < 0) {
    throw new Error('Conversation not found')
  }

  const message: MessageRecord = {
    id: nextId('msg'),
    conversationId,
    senderId: ctx.userId ?? 'anonymous',
    senderName: ctx.userId ? 'You' : 'Shell User',
    body,
    sentAt: new Date().toISOString()
  }

  conversations[conversationIndex] = {
    ...conversations[conversationIndex],
    unreadCount: Math.max(0, conversations[conversationIndex].unreadCount - 1),
    updatedAt: message.sentAt,
    messages: [...conversations[conversationIndex].messages, message]
  }

  return message
}
