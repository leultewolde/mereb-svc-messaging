import { MessageBodyEmptyError } from './errors.js';

export function normalizeMessageBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new MessageBodyEmptyError();
  }
  return trimmed;
}
