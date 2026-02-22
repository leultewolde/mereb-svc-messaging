export interface DomainEvent<TType extends string, TPayload> {
  type: TType;
  occurredAt: Date;
  payload: TPayload;
}

export type ConversationCreatedDomainEvent = DomainEvent<
  'ConversationCreated',
  {
    conversationId: string;
    participantIds: string[];
  }
>;

export type MessageSentDomainEvent = DomainEvent<
  'MessageSent',
  {
    messageId: string;
    conversationId: string;
    senderId: string;
  }
>;

export function conversationCreatedEvent(
  conversationId: string,
  participantIds: string[]
): ConversationCreatedDomainEvent {
  return {
    type: 'ConversationCreated',
    occurredAt: new Date(),
    payload: {
      conversationId,
      participantIds
    }
  };
}

export function messageSentEvent(
  messageId: string,
  conversationId: string,
  senderId: string
): MessageSentDomainEvent {
  return {
    type: 'MessageSent',
    occurredAt: new Date(),
    payload: {
      messageId,
      conversationId,
      senderId
    }
  };
}
