import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolvers } from '../src/adapters/inbound/graphql/resolvers.js';
import type { MessagingApplicationModule } from '../src/application/messaging/use-cases.js';

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
    { userId: 'u1' }
  )) as { body: string };

  assert.equal(receivedBody, 'hello');
  assert.equal(result.body, 'hello');
});
