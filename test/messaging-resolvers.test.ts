import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createResolvers } from '../src/adapters/inbound/graphql/resolvers.js';
import type { MessagingApplicationModule } from '../src/application/messaging/use-cases.js';
import { ConversationNotFoundError, MissingRecipientError } from '../src/domain/messaging/errors.js';
import type { MessagingPubSub } from '../src/context.js';
import {
  conversationUpdatedTopic,
  messageReceivedTopic
} from '../src/adapters/inbound/graphql/subscriptions.js';

function createMessagingStub(): MessagingApplicationModule {
  return {
    commands: {
      sendMessage: {
        async execute(input) {
          return {
            id: 'm1',
            conversationId: input.conversationId ?? 'c1',
            senderId: 'u1',
            senderName: 'You',
            body: input.body,
            sentAt: new Date('2026-01-01T00:00:00.000Z')
          };
        }
      } as MessagingApplicationModule['commands']['sendMessage'],
      markConversationRead: {
        async execute(input) {
          return {
            id: input.conversationId,
            title: 'Conversation',
            participantIds: ['u1', 'u2'],
            unreadCount: 0,
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            createdAt: new Date('2026-01-01T00:00:00.000Z')
          };
        }
      } as MessagingApplicationModule['commands']['markConversationRead'],
      ensureSeedData: {
        async execute() {}
      } as MessagingApplicationModule['commands']['ensureSeedData']
    },
    queries: {
      listConversations: {
        async execute() {
          return [];
        }
      } as MessagingApplicationModule['queries']['listConversations'],
      getConversation: {
        async execute() {
          return null;
        }
      } as MessagingApplicationModule['queries']['getConversation'],
      listMessages: {
        async execute() {
          return {
            edges: [],
            pageInfo: { endCursor: null, hasNextPage: false }
          };
        }
      } as MessagingApplicationModule['queries']['listMessages'],
      resolveConversationReference: {
        async execute() {
          return null;
        }
      } as MessagingApplicationModule['queries']['resolveConversationReference'],
      getConversationLastMessage: {
        async execute() {
          return null;
        }
      } as MessagingApplicationModule['queries']['getConversationLastMessage']
    },
    helpers: {
      toExecutionContext: (ctx) =>
        ctx.userId ? { principal: { userId: ctx.userId } } : {}
    }
  };
}

function createPubSubRecorder() {
  const published: Array<{ topic: string; payload: unknown }> = [];
  const pubsub: MessagingPubSub = {
    publish(event) {
      published.push(event);
    },
    async subscribe(topic) {
      const normalizedTopic = Array.isArray(topic) ? topic.join(',') : topic;
      return (async function* () {
        yield normalizedTopic;
      })();
    }
  };

  return { pubsub, published };
}

test('resolver sendMessage preserves empty-body error message', async () => {
  const resolvers = createResolvers(createMessagingStub());
  const sendMessage = (
    resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>
  ).sendMessage;

  await assert.rejects(
    () => sendMessage({}, { body: '   ' }, { userId: 'u1' }),
    (error) =>
      error instanceof Error && error.message === 'Message body cannot be empty'
  );
});

test('resolver sendMessage delegates trimmed body to use case', async () => {
  let receivedBody = '';
  const messaging = createMessagingStub();
  const { pubsub, published } = createPubSubRecorder();
  messaging.commands.sendMessage = {
    async execute(input) {
      receivedBody = input.body;
      return {
        id: 'm1',
        conversationId: 'c1',
        senderId: 'u1',
        senderName: 'You',
        body: input.body,
        sentAt: new Date('2026-01-01T00:00:00.000Z')
      };
    }
  } as MessagingApplicationModule['commands']['sendMessage'];

  const resolvers = createResolvers(messaging);
  const sendMessage = (
    resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>
  ).sendMessage;

  const result = (await sendMessage(
    {},
    { body: '  hello  ', conversationId: 'c1' },
    { userId: 'u1', pubsub }
  )) as { body: string };

  assert.equal(receivedBody, 'hello');
  assert.equal(result.body, 'hello');
  assert.deepEqual(published, [
    {
      topic: messageReceivedTopic('c1'),
      payload: {
        messageReceived: {
          id: 'm1',
          conversationId: 'c1',
          senderId: 'u1',
          senderName: 'You',
          body: 'hello',
          sentAt: new Date('2026-01-01T00:00:00.000Z')
        }
      }
    }
  ]);
});

test('conversation queries delegate to the application module', async () => {
  let listConversationsCalled = false;
  let listMessagesArgs:
    | { conversationId: string; after?: string; limit?: number }
    | null = null;
  const messaging = createMessagingStub();
  messaging.queries.listConversations = {
    async execute() {
      listConversationsCalled = true;
      return [];
    }
  } as MessagingApplicationModule['queries']['listConversations'];
  messaging.queries.listMessages = {
    async execute(input) {
      listMessagesArgs = input;
      return {
        edges: [],
        pageInfo: { endCursor: null, hasNextPage: false }
      };
    }
  } as MessagingApplicationModule['queries']['listMessages'];

  const resolvers = createResolvers(messaging);
  const query = resolvers.Query as Record<string, (...args: unknown[]) => Promise<unknown>>;

  await query.conversations({}, {}, { userId: 'u1' });
  await query.messages(
    {},
    { conversationId: 'c1', after: 'm1', limit: 5 },
    { userId: 'u1' }
  );

  assert.equal(listConversationsCalled, true);
  assert.deepEqual(listMessagesArgs, {
    conversationId: 'c1',
    after: 'm1',
    limit: 5
  });
});

test('conversation lastMessage field delegates to the query layer', async () => {
  let requestedConversationId = '';
  const messaging = createMessagingStub();
  messaging.queries.getConversationLastMessage = {
    async execute(input) {
      requestedConversationId = input.conversationId;
      return null;
    }
  } as MessagingApplicationModule['queries']['getConversationLastMessage'];

  const resolvers = createResolvers(messaging);
  const conversation = resolvers.Conversation as Record<string, (...args: unknown[]) => Promise<unknown>>;

  await conversation.lastMessage({ id: 'c42' });

  assert.equal(requestedConversationId, 'c42');
});

test('messaging resolvers delegate conversation/entity queries and map domain errors', async () => {
  const calls: Array<{ kind: string; payload: unknown }> = [];
  const messaging = createMessagingStub();
  messaging.queries.getConversation = {
    async execute(input, ctx) {
      calls.push({ kind: 'getConversation', payload: { input, ctx } });
      return null;
    }
  } as MessagingApplicationModule['queries']['getConversation'];
  messaging.queries.resolveConversationReference = {
    async execute(input) {
      calls.push({ kind: 'resolveConversationReference', payload: input });
      return { id: input.id };
    }
  } as MessagingApplicationModule['queries']['resolveConversationReference'];
  messaging.queries.listMessages = {
    async execute() {
      throw new ConversationNotFoundError();
    }
  } as MessagingApplicationModule['queries']['listMessages'];
  messaging.commands.sendMessage = {
    async execute() {
      throw new MissingRecipientError();
    }
  } as MessagingApplicationModule['commands']['sendMessage'];

  const resolvers = createResolvers(messaging);
  const query = resolvers.Query as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const mutation = resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>;

  await query.conversation({}, { id: 'c1' }, { userId: 'u1' });
  const entities = await query._entities(
    {},
    {
      representations: [
        { __typename: 'Conversation', id: 'c1' },
        { __typename: 'Unknown', id: 'x' }
      ]
    },
    {}
  );
  assert.deepEqual(query._service({}, {}, {}), { sdl: null });

  await assert.rejects(
    () => query.messages({}, { conversationId: 'c1' }, { userId: 'u1' }),
    (error) => error instanceof Error && error.message === 'Conversation not found'
  );
  await assert.rejects(
    () => mutation.sendMessage({}, { body: 'hello' }, { userId: 'u1' }),
    (error) =>
      error instanceof Error &&
      error.message === 'toUserId is required when conversationId is not provided'
  );
  const readResult = await mutation.markConversationRead(
    {},
    { conversationId: 'c1' },
    { userId: 'u1' }
  );

  assert.equal(entities[0] !== null, true);
  assert.equal(entities[1], null);
  assert.equal((readResult as { unreadCount: number }).unreadCount, 0);
  assert.deepEqual(calls, [
    {
      kind: 'getConversation',
      payload: { input: { id: 'c1' }, ctx: { principal: { userId: 'u1' } } }
    },
    { kind: 'resolveConversationReference', payload: { id: 'c1' } }
  ]);
});

test('resolver sendMessage publishes message and conversation updates when pubsub is available', async () => {
  const { pubsub, published } = createPubSubRecorder();
  const messaging = createMessagingStub();
  messaging.queries.resolveConversationReference = {
    async execute(input) {
      assert.deepEqual(input, { id: 'c1' });
      return {
        id: 'c1',
        participantIds: ['u1', 'u2']
      };
    }
  } as MessagingApplicationModule['queries']['resolveConversationReference'];

  const resolvers = createResolvers(messaging);
  const sendMessage = (
    resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>
  ).sendMessage;

  await sendMessage({}, { body: 'hello', conversationId: 'c1' }, { userId: 'u1', pubsub });

  assert.deepEqual(published, [
    {
      topic: messageReceivedTopic('c1'),
      payload: {
        messageReceived: {
          id: 'm1',
          conversationId: 'c1',
          senderId: 'u1',
          senderName: 'You',
          body: 'hello',
          sentAt: new Date('2026-01-01T00:00:00.000Z')
        }
      }
    },
    {
      topic: conversationUpdatedTopic('u1'),
      payload: {
        conversationUpdated: {
          id: 'c1'
        }
      }
    },
    {
      topic: conversationUpdatedTopic('u2'),
      payload: {
        conversationUpdated: {
          id: 'c1'
        }
      }
    }
  ]);
});

test('resolver markConversationRead publishes a conversation update for the viewer', async () => {
  const { pubsub, published } = createPubSubRecorder();
  const resolvers = createResolvers(createMessagingStub());
  const markConversationRead = (
    resolvers.Mutation as Record<string, (...args: unknown[]) => Promise<unknown>>
  ).markConversationRead;

  await markConversationRead({}, { conversationId: 'c1' }, { userId: 'u1', pubsub });

  assert.deepEqual(published, [
    {
      topic: conversationUpdatedTopic('u1'),
      payload: {
        conversationUpdated: {
          id: 'c1'
        }
      }
    }
  ]);
});

test('conversation field resolvers throw when a partial conversation cannot be hydrated', async () => {
  const messaging = createMessagingStub();
  const resolvers = createResolvers(messaging);
  const conversation = resolvers.Conversation as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;

  await assert.rejects(
    () => conversation.title({ id: 'c404' }, {}, { userId: 'u1' }),
    (error) => error instanceof ConversationNotFoundError
  );
});

test('messageReceived subscription verifies access and subscribes to the conversation topic', async () => {
  let requestedConversationId = '';
  let subscribedTopic = '';
  const pubsub: MessagingPubSub = {
    publish() {},
    async subscribe(topic) {
      subscribedTopic = Array.isArray(topic) ? topic.join(',') : topic;
      return (async function* () {})();
    }
  };
  const messaging = createMessagingStub();
  messaging.queries.getConversation = {
    async execute(input) {
      requestedConversationId = input.id;
      return { id: input.id };
    }
  } as MessagingApplicationModule['queries']['getConversation'];

  const resolvers = createResolvers(messaging);
  const subscription = resolvers.Subscription as Record<
    string,
    { subscribe: (...args: unknown[]) => Promise<unknown> }
  >;

  const result = await subscription.messageReceived.subscribe(
    {},
    { conversationId: 'c42' },
    { userId: 'u1', pubsub }
  );

  assert.equal(typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator], 'function');
  assert.equal(requestedConversationId, 'c42');
  assert.equal(subscribedTopic, messageReceivedTopic('c42'));
});

test('conversationUpdated subscription requires authentication and uses the viewer topic', async () => {
  let subscribedTopic = '';
  const pubsub: MessagingPubSub = {
    publish() {},
    async subscribe(topic) {
      subscribedTopic = Array.isArray(topic) ? topic.join(',') : topic;
      return (async function* () {})();
    }
  };
  const resolvers = createResolvers(createMessagingStub());
  const subscription = resolvers.Subscription as Record<
    string,
    { subscribe: (...args: unknown[]) => Promise<unknown> }
  >;

  await assert.rejects(
    () => subscription.conversationUpdated.subscribe({}, {}, { pubsub }),
    (error) => error instanceof Error && error.message === 'Authentication required'
  );
  await assert.rejects(
    () => subscription.conversationUpdated.subscribe({}, {}, { userId: 'u1' }),
    (error) => error instanceof Error && error.message === 'Subscriptions are unavailable'
  );

  const result = await subscription.conversationUpdated.subscribe(
    {},
    {},
    { userId: 'u1', pubsub }
  );

  assert.equal(typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator], 'function');
  assert.equal(subscribedTopic, conversationUpdatedTopic('u1'));
});
