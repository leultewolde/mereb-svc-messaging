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
  MessagingEventPublisherPort,
  MessagingRepositoryPort
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
    private readonly events: MessagingEventPublisherPort
  ) {}

  async execute(
    input: { conversationId?: string; toUserId?: string; body: string },
    ctx: MessagingExecutionContext
  ): Promise<MessageRecord> {
    const senderId = requireAuthToSend(ctx);
    const body = normalizeMessageBody(input.body);

    let targetConversationId = input.conversationId;
    let createdConversation: ConversationRecord | null = null;

    if (!targetConversationId) {
      if (!input.toUserId) {
        throw new MissingRecipientError();
      }

      const existing = await this.repository.findDirectConversation(
        senderId,
        input.toUserId
      );

      if (existing) {
        targetConversationId = existing.id;
      } else {
        createdConversation = await this.repository.createDirectConversation({
          participantIds: [senderId, input.toUserId]
        });
        targetConversationId = createdConversation.id;
      }
    }

    const conversation = await this.repository.findConversationById(targetConversationId);
    if (!conversation) {
      throw new ConversationNotFoundError();
    }

    const message = await this.repository.createMessage({
      conversationId: targetConversationId,
      senderId,
      senderName: 'You',
      body
    });

    await this.repository.touchConversationOnMessage({
      conversationId: targetConversationId,
      currentUnreadCount: conversation.unreadCount
    });

    if (createdConversation) {
      const event = conversationCreatedEvent(
        createdConversation.id,
        createdConversation.participantIds
      );
      await this.events.publishConversationCreated({
        conversationId: event.payload.conversationId,
        participantIds: event.payload.participantIds
      });
    }

    const sent = messageSentEvent(message.id, message.conversationId, message.senderId);
    await this.events.publishMessageSent({
      messageId: sent.payload.messageId,
      conversationId: sent.payload.conversationId,
      senderId: sent.payload.senderId
    });

    return message;
  }
}

export interface MessagingApplicationModule {
  commands: {
    sendMessage: SendMessageUseCase;
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
  eventPublisher: MessagingEventPublisherPort;
}): MessagingApplicationModule {
  return {
    commands: {
      sendMessage: new SendMessageUseCase(deps.repository, deps.eventPublisher),
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
