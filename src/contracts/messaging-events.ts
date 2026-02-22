export const MESSAGING_EVENT_TOPICS = {
  conversationCreated: 'messaging.conversation.created.v1',
  messageSent: 'messaging.message.sent.v1'
} as const;

export interface MessagingConversationCreatedEventData {
  conversation_id: string;
  participant_ids: string[];
}

export interface MessagingMessageSentEventData {
  message_id: string;
  conversation_id: string;
  sender_id: string;
}
