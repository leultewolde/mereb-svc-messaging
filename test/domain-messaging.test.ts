import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessageBody } from '../src/domain/messaging/message.js';
import { MessageBodyEmptyError } from '../src/domain/messaging/errors.js';

test('normalizeMessageBody trims body', () => {
  assert.equal(normalizeMessageBody('  hello  '), 'hello');
});

test('normalizeMessageBody rejects empty strings', () => {
  assert.throws(
    () => normalizeMessageBody('   '),
    (error) => error instanceof MessageBodyEmptyError
  );
});
