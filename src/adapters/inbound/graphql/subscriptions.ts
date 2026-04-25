import type { MessageRecord } from '../../../application/messaging/ports.js';
import type { MessagingPubSub } from '../../../context.js';

export const MESSAGE_RECEIVED_TOPIC_PREFIX = 'MESSAGING_MESSAGE_RECEIVED';
export const CONVERSATION_UPDATED_TOPIC_PREFIX = 'MESSAGING_CONVERSATION_UPDATED';

export function messageReceivedTopic(conversationId: string): string {
  return `${MESSAGE_RECEIVED_TOPIC_PREFIX}:${conversationId}`;
}

export function conversationUpdatedTopic(userId: string): string {
  return `${CONVERSATION_UPDATED_TOPIC_PREFIX}:${userId}`;
}

export function publishMessageReceived(
  pubsub: MessagingPubSub | undefined,
  message: MessageRecord
): void {
  pubsub?.publish({
    topic: messageReceivedTopic(message.conversationId),
    payload: {
      messageReceived: message
    }
  });
}

export function publishConversationUpdated(
  pubsub: MessagingPubSub | undefined,
  conversationId: string,
  userId: string
): void {
  pubsub?.publish({
    topic: conversationUpdatedTopic(userId),
    payload: {
      conversationUpdated: {
        id: conversationId
      }
    }
  });
}
