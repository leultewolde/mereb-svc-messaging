export type MessagingPubSub = {
  subscribe(topic: string | string[]): Promise<AsyncIterable<unknown>>;
  publish(event: { topic: string; payload: unknown }): void;
};

export type GraphQLContext = {
  userId?: string;
  pubsub?: MessagingPubSub;
}
