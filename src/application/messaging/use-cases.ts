import {
  AuthenticationRequiredError,
  ConversationNotFoundError,
  MissingRecipientError
} from '../../domain/messaging/errors.js';
import {
  conversationCreatedEvent,
  messageSentEvent
} from '../../domain/messaging/events.js';
import { normalizeMessageBody } from '../../domain/messaging/message.js';
import type { GraphQLContext } from '../../context.js';
import type {
  ConversationRecord,
  MessageConnection,
  MessageRecord,
  MessagingRepositoryPort,
  MessagingTransactionPort
} from './ports.js';
import type { MessagingExecutionContext } from './context.js';

function toExecutionContext(ctx: GraphQLContext): MessagingExecutionContext {
  return ctx.userId ? { principal: { userId: ctx.userId } } : {};
}

function requireAuth(ctx: MessagingExecutionContext): string {
  const userId = ctx.principal?.userId;
  if (!userId) {
    throw new AuthenticationRequiredError('Authentication required');
  }
  return userId;
}

function requireAuthToSend(ctx: MessagingExecutionContext): string {
  const userId = ctx.principal?.userId;
  if (!userId) {
    throw new AuthenticationRequiredError('Authentication required to send messages');
  }
  return userId;
}

export class EnsureMessagingSeedDataUseCase {
  constructor(private readonly repository: MessagingRepositoryPort) {}

  async execute(): Promise<void> {
    await this.repository.ensureSeedData();
  }
}

export class ListConversationsQuery {
  constructor(private readonly repository: MessagingRepositoryPort) {}

  async execute(ctx: MessagingExecutionContext): Promise<ConversationRecord[]> {
    const userId = requireAuth(ctx);
    return this.repository.listUserConversations(userId);
  }
}

export class GetConversationQuery {
  constructor(private readonly repository: MessagingRepositoryPort) {}

  async execute(
    input: { id: string },
    ctx: MessagingExecutionContext
  ): Promise<ConversationRecord | null> {
    const userId = requireAuth(ctx);
    return this.repository.findUserConversation(input.id, userId);
  }
}

export class ListMessagesQuery {
  constructor(private readonly repository: MessagingRepositoryPort) {}

  async execute(
    input: { conversationId: string; after?: string; limit?: number },
    ctx: MessagingExecutionContext
  ): Promise<MessageConnection> {
    const userId = requireAuth(ctx);
    const conversation = await this.repository.findUserConversation(
      input.conversationId,
      userId
    );
    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    return this.repository.listMessages(input.conversationId, input.after, limit);
  }
}

export class ResolveConversationReferenceQuery {
  constructor(private readonly repository: MessagingRepositoryPort) {}

  async execute(input: { id: string }): Promise<ConversationRecord | null> {
    return this.repository.findConversationById(input.id);
  }
}

export class GetConversationLastMessageQuery {
  constructor(private readonly repository: MessagingRepositoryPort) {}

  async execute(input: { conversationId: string }): Promise<MessageRecord | null> {
    return this.repository.findLatestMessage(input.conversationId);
  }
}

export class SendMessageUseCase {
  constructor(
    private readonly repository: MessagingRepositoryPort,
    private readonly transactionRunner: MessagingTransactionPort
  ) {}

  async execute(
    input: { conversationId?: string; toUserId?: string; body: string },
    ctx: MessagingExecutionContext
  ): Promise<MessageRecord> {
    const senderId = requireAuthToSend(ctx);
    const body = normalizeMessageBody(input.body);

    return this.transactionRunner.run(async ({ repository, eventPublisher }) => {
      let targetConversationId = input.conversationId;
      let createdConversation: ConversationRecord | null = null;

      if (!targetConversationId) {
        if (!input.toUserId) {
          throw new MissingRecipientError();
        }

        const existing = await repository.findDirectConversation(
          senderId,
          input.toUserId
        );

        if (existing) {
          targetConversationId = existing.id;
        } else {
          createdConversation = await repository.createDirectConversation({
            participantIds: [senderId, input.toUserId]
          });
          targetConversationId = createdConversation.id;
        }
      }

      const conversation = await repository.findUserConversation(
        targetConversationId,
        senderId
      );
      if (!conversation) {
        throw new ConversationNotFoundError();
      }

      const message = await repository.createMessage({
        conversationId: targetConversationId,
        senderId,
        senderName: 'You',
        body
      });

      await repository.recordMessageSent({
        conversationId: targetConversationId,
        participantIds: conversation.participantIds,
        senderId,
        sentAt: message.sentAt
      });

      if (createdConversation) {
        const event = conversationCreatedEvent(
          createdConversation.id,
          createdConversation.participantIds
        );
        await eventPublisher.publishConversationCreated({
          conversationId: event.payload.conversationId,
          participantIds: event.payload.participantIds
        });
      }

      const recipientIds = conversation.participantIds.filter(
        (participantId) => participantId !== senderId
      );
      const sent = messageSentEvent(
        message.id,
        message.conversationId,
        message.senderId,
        recipientIds
      );
      await eventPublisher.publishMessageSent({
        messageId: sent.payload.messageId,
        conversationId: sent.payload.conversationId,
        senderId: sent.payload.senderId,
        recipientIds: sent.payload.recipientIds
      });

      return message;
    });
  }
}

export class MarkConversationReadUseCase {
  constructor(private readonly repository: MessagingRepositoryPort) {}

  async execute(
    input: { conversationId: string },
    ctx: MessagingExecutionContext
  ): Promise<ConversationRecord> {
    const userId = requireAuth(ctx);
    const conversation = await this.repository.findUserConversation(
      input.conversationId,
      userId
    );
    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    await this.repository.markConversationRead({
      conversationId: input.conversationId,
      userId
    });

    return (
      (await this.repository.findUserConversation(input.conversationId, userId)) ??
      {
        ...conversation,
        unreadCount: 0
      }
    );
  }
}

export interface MessagingApplicationModule {
  commands: {
    sendMessage: SendMessageUseCase;
    markConversationRead: MarkConversationReadUseCase;
    ensureSeedData: EnsureMessagingSeedDataUseCase;
  };
  queries: {
    listConversations: ListConversationsQuery;
    getConversation: GetConversationQuery;
    listMessages: ListMessagesQuery;
    resolveConversationReference: ResolveConversationReferenceQuery;
    getConversationLastMessage: GetConversationLastMessageQuery;
  };
  helpers: {
    toExecutionContext: (ctx: GraphQLContext) => MessagingExecutionContext;
  };
}

export function createMessagingApplicationModule(deps: {
  repository: MessagingRepositoryPort;
  transactionRunner: MessagingTransactionPort;
}): MessagingApplicationModule {
  return {
    commands: {
      sendMessage: new SendMessageUseCase(deps.repository, deps.transactionRunner),
      markConversationRead: new MarkConversationReadUseCase(deps.repository),
      ensureSeedData: new EnsureMessagingSeedDataUseCase(deps.repository)
    },
    queries: {
      listConversations: new ListConversationsQuery(deps.repository),
      getConversation: new GetConversationQuery(deps.repository),
      listMessages: new ListMessagesQuery(deps.repository),
      resolveConversationReference: new ResolveConversationReferenceQuery(
        deps.repository
      ),
      getConversationLastMessage: new GetConversationLastMessageQuery(deps.repository)
    },
    helpers: {
      toExecutionContext
    }
  };
}
