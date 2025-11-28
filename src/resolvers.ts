import type { IResolvers } from '@graphql-tools/utils'
import type { GraphQLContext } from './context.js'
import { addMessage, findConversation, listConversations, listMessages } from './data.js'

export const resolvers: IResolvers = {
  Query: {
    conversations: () => listConversations(),
    conversation: (_source, args: { id: string }) => findConversation(args.id),
    messages: (_source, args: { conversationId: string; after?: string; limit?: number }) => {
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 50)
      return listMessages(args.conversationId, args.after, limit)
    },
    _entities: (_source, args: { representations: Array<{ __typename?: string; id?: string }> }) => {
      return args.representations.map((representation) => {
        if (representation.__typename === 'Conversation' && representation.id) {
          return findConversation(String(representation.id)) ?? null
        }
        return null
      })
    },
    _service: () => ({ sdl: null })
  },
  Mutation: {
    sendMessage: (_source, args: { conversationId: string; body: string }, ctx: GraphQLContext) => {
      const trimmed = args.body.trim()
      if (!trimmed) {
        throw new Error('Message body cannot be empty')
      }
      return addMessage(args.conversationId, trimmed, ctx)
    }
  },
  Conversation: {
    lastMessage: (conversation) => {
      const messages = [...conversation.messages].sort((a, b) => (a.sentAt > b.sentAt ? -1 : 1))
      return messages[0] ?? null
    }
  }
}
