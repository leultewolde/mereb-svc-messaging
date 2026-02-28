import {
  createMessagingApplicationModule,
  type MessagingApplicationModule
} from '../application/messaging/use-cases.js';
import {
  PrismaMessagingRepository,
  PrismaMessagingTransactionRunner
} from '../adapters/outbound/prisma/messaging-prisma-repository.js';

export interface MessagingContainer {
  messaging: MessagingApplicationModule;
}

export function createContainer(): MessagingContainer {
  const repository = new PrismaMessagingRepository();
  const transactionRunner = new PrismaMessagingTransactionRunner();

  return {
    messaging: createMessagingApplicationModule({
      repository,
      transactionRunner
    })
  };
}
