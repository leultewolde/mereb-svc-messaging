import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeMessageBody } from '../src/domain/messaging/message.js';
import {
  AuthenticationRequiredError,
  ConversationNotFoundError,
  MessageBodyEmptyError,
  MissingRecipientError
} from '../src/domain/messaging/errors.js';

test('normalizeMessageBody trims body', () => {
  assert.equal(normalizeMessageBody('  hello  '), 'hello');
});

test('normalizeMessageBody rejects empty strings', () => {
  assert.throws(
    () => normalizeMessageBody('   '),
    (error) => error instanceof MessageBodyEmptyError
  );
});

test('messaging domain errors preserve expected codes and messages', () => {
  const auth = new AuthenticationRequiredError();
  assert.equal(auth.code, 'AUTHENTICATION_REQUIRED');
  assert.equal(auth.message, 'Authentication required');

  const missingRecipient = new MissingRecipientError();
  assert.equal(missingRecipient.code, 'MISSING_RECIPIENT');
  assert.match(missingRecipient.message, /toUserId is required/);

  const missingConversation = new ConversationNotFoundError();
  assert.equal(missingConversation.code, 'CONVERSATION_NOT_FOUND');
  assert.equal(missingConversation.message, 'Conversation not found');
});
