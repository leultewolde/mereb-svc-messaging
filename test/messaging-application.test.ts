import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  createMessagingApplicationModule
} from '../src/application/messaging/use-cases.js';
import type {
  ConversationRecord,
  MessageConnection,
  MessageRecord,
  MessagingEventPublisherPort,
  MessagingRepositoryPort,
  MessagingTransactionPort
} from '../src/application/messaging/ports.js';
import {
  AuthenticationRequiredError,
  ConversationNotFoundError,
  MissingRecipientError
} from '../src/domain/messaging/errors.js';

function conversation(partial: Partial<ConversationRecord> & Pick<ConversationRecord, 'id'>): ConversationRecord {
  return {
    id: partial.id,
    title: partial.title ?? 'Conversation',
    participantIds: partial.participantIds ?? ['u1', 'u2'],
    unreadCount: partial.unreadCount ?? 0,
    updatedAt: partial.updatedAt ?? new Date('2026-01-01T00:00:00.000Z'),
    createdAt: partial.createdAt ?? new Date('2026-01-01T00:00:00.000Z')
  };
}

function message(partial: Partial<MessageRecord> & Pick<MessageRecord, 'id' | 'conversationId' | 'senderId' | 'body'>): MessageRecord {
  return {
    id: partial.id,
    conversationId: partial.conversationId,
    senderId: partial.senderId,
    senderName: partial.senderName ?? null,
    body: partial.body,
    sentAt: partial.sentAt ?? new Date('2026-01-01T00:00:00.000Z')
  };
}

class FakeRepo implements MessagingRepositoryPort {
  conversations = new Map<string, ConversationRecord>();
  directIndex = new Map<string, string>();
  messages: MessageRecord[] = [];
  seeded = false;
  touched: Array<{ conversationId: string; currentUnreadCount: number }> = [];

  async ensureSeedData(): Promise<void> {
    this.seeded = true;
  }
  async listUserConversations(userId: string): Promise<ConversationRecord[]> {
    return Array.from(this.conversations.values()).filter((c) =>
      c.participantIds.includes(userId)
    );
  }
  async findUserConversation(id: string, userId: string): Promise<ConversationRecord | null> {
    const c = this.conversations.get(id);
    return c && c.participantIds.includes(userId) ? c : null;
  }
  async findConversationById(id: string): Promise<ConversationRecord | null> {
    return this.conversations.get(id) ?? null;
  }
  async findDirectConversation(userId: string, otherUserId: string): Promise<ConversationRecord | null> {
    const key = [userId, otherUserId].sort().join('|');
    const id = this.directIndex.get(key);
    return id ? (this.conversations.get(id) ?? null) : null;
  }
  async createDirectConversation(input: { participantIds: [string, string] }): Promise<ConversationRecord> {
    const c = conversation({
      id: `c${this.conversations.size + 1}`,
      title: 'Direct message',
      participantIds: [...input.participantIds]
    });
    this.conversations.set(c.id, c);
    const key = [...input.participantIds].sort().join('|');
    this.directIndex.set(key, c.id);
    return c;
  }
  async listMessages(): Promise<MessageConnection> {
    return {
      edges: this.messages.map((m) => ({ node: m, cursor: m.id })),
      pageInfo: { endCursor: this.messages.at(-1)?.id ?? null, hasNextPage: false }
    };
  }
  async createMessage(input: {
    conversationId: string;
    senderId: string;
    senderName?: string | null;
    body: string;
  }): Promise<MessageRecord> {
    const m = message({
      id: `m${this.messages.length + 1}`,
      conversationId: input.conversationId,
      senderId: input.senderId,
      senderName: input.senderName ?? null,
      body: input.body
    });
    this.messages.push(m);
    return m;
  }
  async touchConversationOnMessage(input: {
    conversationId: string;
    currentUnreadCount: number;
  }): Promise<void> {
    this.touched.push(input);
  }
  async findLatestMessage(conversationId: string): Promise<MessageRecord | null> {
    const found = [...this.messages]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
    return found ?? null;
  }
}

class FakeEvents implements MessagingEventPublisherPort {
  calls: Array<{ type: string; payload: unknown }> = [];
  async publishConversationCreated(input: {
    conversationId: string;
    participantIds: string[];
  }): Promise<void> {
    this.calls.push({ type: 'conversationCreated', payload: input });
  }
  async publishMessageSent(input: {
    messageId: string;
    conversationId: string;
    senderId: string;
  }): Promise<void> {
    this.calls.push({ type: 'messageSent', payload: input });
  }
}

function transactionRunner(
  repository: MessagingRepositoryPort,
  eventPublisher: MessagingEventPublisherPort
): MessagingTransactionPort {
  return {
    async run<T>(callback): Promise<T> {
      return callback({ repository, eventPublisher });
    }
  };
}

test('sendMessage creates direct conversation when needed and publishes events', async () => {
  const repo = new FakeRepo();
  const events = new FakeEvents();
  const messaging = createMessagingApplicationModule({
    repository: repo,
    transactionRunner: transactionRunner(repo, events)
  });

  const result = await messaging.commands.sendMessage.execute(
    { toUserId: 'u2', body: '  hi there  ' },
    { principal: { userId: 'u1' } }
  );

  assert.equal(result.body, 'hi there');
  assert.equal(repo.messages.length, 1);
  assert.deepEqual(events.calls.map((c) => c.type), [
    'conversationCreated',
    'messageSent'
  ]);
});

test('sendMessage throws when unauthenticated', async () => {
  const repo = new FakeRepo();
  const events = new FakeEvents();
  const messaging = createMessagingApplicationModule({
    repository: repo,
    transactionRunner: transactionRunner(repo, events)
  });

  await assert.rejects(
    () => messaging.commands.sendMessage.execute({ body: 'hello' }, {}),
    (error) =>
      error instanceof Error &&
      error.message === 'Authentication required to send messages'
  );
});

test('messaging queries and seed command delegate through the repository', async () => {
  const repo = new FakeRepo();
  const events = new FakeEvents();
  const convo = conversation({ id: 'c1', participantIds: ['u1', 'u2'] });
  repo.conversations.set(convo.id, convo);
  repo.messages.push(
    message({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u1',
      body: 'hello'
    })
  );

  const messaging = createMessagingApplicationModule({
    repository: repo,
    transactionRunner: transactionRunner(repo, events)
  });

  await messaging.commands.ensureSeedData.execute();
  const ctx = messaging.helpers.toExecutionContext({ userId: 'u1' });

  assert.equal(repo.seeded, true);
  assert.equal((await messaging.queries.listConversations.execute(ctx)).length, 1);
  assert.equal(
    (await messaging.queries.getConversation.execute({ id: 'c1' }, ctx))?.id,
    'c1'
  );
  assert.equal(
    (await messaging.queries.resolveConversationReference.execute({ id: 'c1' }))?.id,
    'c1'
  );
  assert.equal(
    (await messaging.queries.getConversationLastMessage.execute({ conversationId: 'c1' }))?.id,
    'm1'
  );

  const messages = await messaging.queries.listMessages.execute(
    { conversationId: 'c1', after: 'm0', limit: 99 },
    ctx
  );
  assert.equal(messages.edges.length, 1);

  await assert.rejects(
    () => messaging.queries.listConversations.execute({}),
    (error) => error instanceof AuthenticationRequiredError
  );
  await assert.rejects(
    () => messaging.queries.listMessages.execute({ conversationId: 'missing' }, ctx),
    (error) => error instanceof ConversationNotFoundError
  );
});

test('sendMessage reuses direct conversations and validates recipients', async () => {
  const repo = new FakeRepo();
  const events = new FakeEvents();
  const convo = conversation({ id: 'c1', participantIds: ['u1', 'u2'] });
  repo.conversations.set(convo.id, convo);
  repo.directIndex.set(['u1', 'u2'].sort().join('|'), convo.id);

  const messaging = createMessagingApplicationModule({
    repository: repo,
    transactionRunner: transactionRunner(repo, events)
  });

  const result = await messaging.commands.sendMessage.execute(
    { toUserId: 'u2', body: 'hello again' },
    { principal: { userId: 'u1' } }
  );

  assert.equal(result.conversationId, 'c1');
  assert.deepEqual(events.calls.map((call) => call.type), ['messageSent']);
  assert.deepEqual(repo.touched, [{ conversationId: 'c1', currentUnreadCount: 0 }]);

  await assert.rejects(
    () => messaging.commands.sendMessage.execute({ body: 'hello' }, { principal: { userId: 'u1' } }),
    (error) => error instanceof MissingRecipientError
  );
  await assert.rejects(
    () => messaging.commands.sendMessage.execute(
      { conversationId: 'missing', body: 'hello' },
      { principal: { userId: 'u1' } }
    ),
    (error) => error instanceof ConversationNotFoundError
  );
});
