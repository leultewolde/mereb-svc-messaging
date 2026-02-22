export interface MessagingExecutionContext {
  principal?: {
    userId: string;
  };
}

export function requireUserId(
  ctx: MessagingExecutionContext,
  message = 'Authentication required'
): string {
  const userId = ctx.principal?.userId;
  if (!userId) {
    throw new Error(message);
  }
  return userId;
}
