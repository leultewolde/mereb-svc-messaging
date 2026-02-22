import {
  createMessagingApplicationModule,
  type MessagingApplicationModule
} from '../application/messaging/use-cases.js';
import { PrismaMessagingRepository } from '../adapters/outbound/prisma/messaging-prisma-repository.js';
import { createMessagingEventPublisherAdapter } from '../adapters/outbound/events/messaging-event-publisher.js';

export interface MessagingContainer {
  messaging: MessagingApplicationModule;
}

export function createContainer(): MessagingContainer {
  const repository = new PrismaMessagingRepository();
  const eventPublisher = createMessagingEventPublisherAdapter();

  return {
    messaging: createMessagingApplicationModule({
      repository,
      eventPublisher
    })
  };
}
