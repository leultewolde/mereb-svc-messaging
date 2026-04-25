import type { IResolvers } from '@graphql-tools/utils';
import type { GraphQLContext } from '../../../context.js';
import {
  AuthenticationRequiredError,
  ConversationNotFoundError,
  MessageBodyEmptyError,
  MissingRecipientError
} from '../../../domain/messaging/errors.js';
import { normalizeMessageBody } from '../../../domain/messaging/message.js';
import type { MessagingApplicationModule } from '../../../application/messaging/use-cases.js';
import {
  conversationUpdatedTopic,
  messageReceivedTopic,
  publishConversationUpdated,
  publishMessageReceived
} from './subscriptions.js';

function toGraphQLError(error: unknown): never {
  if (
    error instanceof AuthenticationRequiredError ||
    error instanceof ConversationNotFoundError ||
    error instanceof MessageBodyEmptyError ||
    error instanceof MissingRecipientError
  ) {
    throw new Error(error.message);
  }

  throw error;
}

export function createResolvers(
  messaging: MessagingApplicationModule
): IResolvers<unknown, GraphQLContext> {
  const resolveConversationForViewer = async (
    conversation: { id: string; title?: string; participantIds?: string[]; unreadCount?: number; updatedAt?: Date | string },
    ctx: GraphQLContext
  ) => {
    if (
      conversation.title !== undefined &&
      conversation.participantIds !== undefined &&
      conversation.unreadCount !== undefined &&
      conversation.updatedAt !== undefined
    ) {
      return conversation;
    }

    const resolved = await messaging.queries.getConversation.execute(
      { id: conversation.id },
      messaging.helpers.toExecutionContext(ctx)
    );

    return resolved ?? conversation;
  };

  return {
    Query: {
      conversations: (_source, _args, ctx) =>
        messaging.queries.listConversations.execute(
          messaging.helpers.toExecutionContext(ctx)
        ),
      conversation: (_source: unknown, args: { id: string }, ctx) =>
        messaging.queries.getConversation.execute(
          { id: args.id },
          messaging.helpers.toExecutionContext(ctx)
        ),
      messages: async (
        _source: unknown,
        args: { conversationId: string; after?: string; limit?: number },
        ctx
      ) => {
        try {
          return await messaging.queries.listMessages.execute(
            {
              conversationId: args.conversationId,
              after: args.after,
              limit: args.limit
            },
            messaging.helpers.toExecutionContext(ctx)
          );
        } catch (error) {
          toGraphQLError(error);
        }
      },
      _entities: async (
        _source: unknown,
        args: { representations: Array<{ __typename?: string; id?: string }> }
      ) =>
        Promise.all(
          args.representations.map(async (representation) => {
            if (representation.__typename === 'Conversation' && representation.id) {
              return messaging.queries.resolveConversationReference.execute({
                id: String(representation.id)
              });
            }
            return null;
          })
        ),
      _service: () => ({ sdl: null })
    },
    Mutation: {
      sendMessage: async (
        _source: unknown,
        args: { conversationId?: string; toUserId?: string; body: string },
        ctx: GraphQLContext
      ) => {
        try {
          // Preserve existing error precedence and message for empty body.
          const body = normalizeMessageBody(args.body);
          const sent = await messaging.commands.sendMessage.execute(
            {
              conversationId: args.conversationId,
              toUserId: args.toUserId,
              body
            },
            messaging.helpers.toExecutionContext(ctx)
          );

          publishMessageReceived(ctx.pubsub, sent);

          const conversation = await messaging.queries.resolveConversationReference.execute({
            id: sent.conversationId
          });

          for (const participantId of conversation?.participantIds ?? []) {
            publishConversationUpdated(
              ctx.pubsub,
              sent.conversationId,
              participantId
            );
          }

          return sent;
        } catch (error) {
          toGraphQLError(error);
        }
      },
      markConversationRead: async (
        _source: unknown,
        args: { conversationId: string },
        ctx: GraphQLContext
      ) => {
        try {
          const conversation = await messaging.commands.markConversationRead.execute(
            { conversationId: args.conversationId },
            messaging.helpers.toExecutionContext(ctx)
          );

          if (ctx.userId) {
            publishConversationUpdated(ctx.pubsub, conversation.id, ctx.userId);
          }

          return conversation;
        } catch (error) {
          toGraphQLError(error);
        }
      }
    },
    Subscription: {
      messageReceived: {
        subscribe: async (
          _source: unknown,
          args: { conversationId: string },
          ctx: GraphQLContext
        ) => {
          const executionContext = messaging.helpers.toExecutionContext(ctx);
          await messaging.queries.listMessages.execute(
            {
              conversationId: args.conversationId,
              limit: 1
            },
            executionContext
          );

          if (!ctx.pubsub) {
            throw new Error('Subscriptions are unavailable');
          }

          return ctx.pubsub.subscribe(messageReceivedTopic(args.conversationId));
        }
      },
      conversationUpdated: {
        subscribe: async (
          _source: unknown,
          _args: unknown,
          ctx: GraphQLContext
        ) => {
          const executionContext = messaging.helpers.toExecutionContext(ctx);
          if (!executionContext.principal?.userId || !ctx.pubsub) {
            throw new Error('Authentication required');
          }

          return ctx.pubsub.subscribe(
            conversationUpdatedTopic(executionContext.principal.userId)
          );
        }
      }
    },
    Conversation: {
      title: async (
        conversation: { id: string; title?: string },
        _args: unknown,
        ctx: GraphQLContext
      ) => (await resolveConversationForViewer(conversation, ctx)).title,
      participantIds: async (
        conversation: { id: string; participantIds?: string[] },
        _args: unknown,
        ctx: GraphQLContext
      ) => (await resolveConversationForViewer(conversation, ctx)).participantIds,
      unreadCount: async (
        conversation: { id: string; unreadCount?: number },
        _args: unknown,
        ctx: GraphQLContext
      ) => (await resolveConversationForViewer(conversation, ctx)).unreadCount,
      updatedAt: async (
        conversation: { id: string; updatedAt?: Date | string },
        _args: unknown,
        ctx: GraphQLContext
      ) => {
        const resolved = await resolveConversationForViewer(conversation, ctx);
        const updatedAt = resolved.updatedAt;
        return updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
      },
      lastMessage: (conversation: { id: string }) =>
        messaging.queries.getConversationLastMessage.execute({
          conversationId: conversation.id
        })
    },
    Message: {
      sentAt: (message: { sentAt: Date | string }) =>
        message.sentAt instanceof Date ? message.sentAt.toISOString() : message.sentAt
    }
  } as IResolvers<unknown, GraphQLContext>;
}
