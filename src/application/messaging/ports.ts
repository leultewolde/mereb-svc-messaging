import type { IntegrationEventEnvelope } from '@mereb/shared-packages';

export interface ConversationRecord {
  id: string;
  title: string;
  participantIds: string[];
  unreadCount: number;
  updatedAt: Date;
  createdAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string | null;
  body: string;
  sentAt: Date;
}

export interface MessageConnection {
  edges: Array<{
    node: MessageRecord;
    cursor: string;
  }>;
  pageInfo: {
    endCursor: string | null;
    hasNextPage: boolean;
  };
}

export interface MessagingRepositoryPort {
  ensureSeedData(): Promise<void>;
  listUserConversations(userId: string): Promise<ConversationRecord[]>;
  findUserConversation(id: string, userId: string): Promise<ConversationRecord | null>;
  findConversationById(id: string): Promise<ConversationRecord | null>;
  findDirectConversation(userId: string, otherUserId: string): Promise<ConversationRecord | null>;
  createDirectConversation(input: {
    participantIds: [string, string];
  }): Promise<ConversationRecord>;
  listMessages(
    conversationId: string,
    after?: string,
    limit?: number
  ): Promise<MessageConnection>;
  createMessage(input: {
    conversationId: string;
    senderId: string;
    senderName?: string | null;
    body: string;
  }): Promise<MessageRecord>;
  touchConversationOnMessage(input: {
    conversationId: string;
    currentUnreadCount: number;
  }): Promise<void>;
  findLatestMessage(conversationId: string): Promise<MessageRecord | null>;
}

export interface MessagingEventPublisherPort {
  publishConversationCreated(input: {
    conversationId: string;
    participantIds: string[];
  }): Promise<void>;
  publishMessageSent(input: {
    messageId: string;
    conversationId: string;
    senderId: string;
  }): Promise<void>;
}

export type PublishEnvelopeFn = <TData>(input: {
  topic: string;
  eventType: string;
  key: string;
  data: TData;
}) => IntegrationEventEnvelope<TData>;
