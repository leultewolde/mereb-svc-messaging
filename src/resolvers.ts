import type { IResolvers } from '@graphql-tools/utils'
import type { GraphQLContext } from './context.js'
import { prisma } from './prisma.js'
import { listConversations, findConversation, listMessages, addMessage } from './store.js'

export const resolvers: IResolvers<unknown, GraphQLContext> = {
  Query: {
    conversations: async (_source, _args, ctx) => {
      if (!ctx.userId) throw new Error('Authentication required')
      return prisma.conversation.findMany({
        where: { participantIds: { has: ctx.userId } },
        orderBy: { updatedAt: 'desc' }
      })
    },
    conversation: async (_source: unknown, args: { id: string }, ctx) => {
      if (!ctx.userId) throw new Error('Authentication required')
      const conversation = await prisma.conversation.findFirst({
        where: { id: args.id, participantIds: { has: ctx.userId } }
      })
      return conversation ?? null
    },
    messages: async (_source: unknown, args: { conversationId: string; after?: string; limit?: number }, ctx) => {
      if (!ctx.userId) throw new Error('Authentication required')
      const membership = await prisma.conversation.findFirst({
        where: { id: args.conversationId, participantIds: { has: ctx.userId } },
        select: { id: true }
      })
      if (!membership) throw new Error('Conversation not found')

      const limit = Math.min(Math.max(args.limit ?? 20, 1), 50)
      return listMessages(args.conversationId, args.after, limit)
    },
    _entities: async (_source: unknown, args: { representations: Array<{ __typename?: string; id?: string }> }) => {
      return Promise.all(
        args.representations.map(async (representation) => {
          if (representation.__typename === 'Conversation' && representation.id) {
            return findConversation(String(representation.id))
          }
          return null
        })
      )
    },
    _service: () => ({ sdl: null })
  },
  Mutation: {
    sendMessage: async (
      _source: unknown,
      args: { conversationId?: string; toUserId?: string; body: string },
      ctx: GraphQLContext
    ) => {
      const trimmed = args.body.trim()
      if (!trimmed) {
        throw new Error('Message body cannot be empty')
      }
      return addMessage(args.conversationId, trimmed, ctx, args.toUserId)
    }
  },
  Conversation: {
    lastMessage: async (conversation: { id: string }) => {
      const latest = await prisma.message.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { sentAt: 'desc' }
      })
      return latest ?? null
    }
  }
}
