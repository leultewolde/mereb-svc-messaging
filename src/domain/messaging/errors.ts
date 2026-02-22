export class MessagingDomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MessagingDomainError';
  }
}

export class AuthenticationRequiredError extends MessagingDomainError {
  constructor(message = 'Authentication required') {
    super('AUTHENTICATION_REQUIRED', message);
  }
}

export class MessageBodyEmptyError extends MessagingDomainError {
  constructor() {
    super('MESSAGE_BODY_EMPTY', 'Message body cannot be empty');
  }
}

export class ConversationNotFoundError extends MessagingDomainError {
  constructor() {
    super('CONVERSATION_NOT_FOUND', 'Conversation not found');
  }
}

export class MissingRecipientError extends MessagingDomainError {
  constructor() {
    super(
      'MISSING_RECIPIENT',
      'toUserId is required when conversationId is not provided'
    );
  }
}
