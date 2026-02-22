// Deprecated module retained as a compatibility shim while imports migrate.
// Prefer the application + adapter modules under src/application and src/adapters.
import { createContainer } from './bootstrap/container.js';
import type { GraphQLContext } from './context.js';

const container = createContainer();

export async function ensureSeedData() {
  await container.messaging.commands.ensureSeedData.execute();
}

export async function findConversation(id: string) {
  return container.messaging.queries.resolveConversationReference.execute({ id });
}

export async function listMessages(
  conversationId: string,
  after?: string,
  limit = 20
) {
  // Legacy helper has no auth context. Preserve old behavior only for direct callers by
  // bypassing membership checks (used historically for internal wiring).
  return container.messaging.queries.listMessages.execute(
    { conversationId, after, limit },
    { principal: { userId: '__legacy__bypass__' } }
  );
}

export async function addMessage(
  conversationId: string | undefined,
  body: string,
  ctx: GraphQLContext,
  toUserId?: string
) {
  return container.messaging.commands.sendMessage.execute(
    { conversationId, body, toUserId },
    ctx.userId ? { principal: { userId: ctx.userId } } : {}
  );
}

export async function listConversations() {
  return [];
}
