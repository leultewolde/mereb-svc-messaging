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
          return await messaging.commands.sendMessage.execute(
            {
              conversationId: args.conversationId,
              toUserId: args.toUserId,
              body
            },
            messaging.helpers.toExecutionContext(ctx)
          );
        } catch (error) {
          toGraphQLError(error);
        }
      }
    },
    Conversation: {
      lastMessage: (conversation: { id: string }) =>
        messaging.queries.getConversationLastMessage.execute({
          conversationId: conversation.id
        })
    }
  } as IResolvers<unknown, GraphQLContext>;
}
