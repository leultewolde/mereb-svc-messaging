import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import underPressure from '@fastify/under-pressure';
import mercurius, { type MercuriusOptions } from 'mercurius';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFastifyLoggerOptions,
  loadEnv,
  parseAuthHeader,
  verifyJwt
} from '@mereb/shared-packages';
import type { GraphQLContext } from '../context.js';
import { createResolvers } from '../adapters/inbound/graphql/resolvers.js';
import { createContainer } from './container.js';

loadEnv();

const typeDefsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'schema.graphql'
);
const typeDefs = readFileSync(typeDefsPath, 'utf8');

function parseIssuerEnv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function verifyJwtWithIssuerFallback(
  token: string,
  options: { issuer: string; audience: string }
) {
  const issuers = parseIssuerEnv(options.issuer);
  let lastError: unknown;

  for (const issuer of issuers) {
    try {
      return await verifyJwt(token, { issuer, audience: options.audience });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('OIDC_ISSUER env var required');
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createFastifyLoggerOptions('svc-messaging')
  });

  await app.register(helmet);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);
  await app.register(underPressure);

  const issuer = process.env.OIDC_ISSUER;
  const audience = process.env.OIDC_AUDIENCE;
  if (!issuer) {
    throw new Error('OIDC_ISSUER env var required');
  }
  if (!audience) {
    throw new Error('OIDC_AUDIENCE env var required');
  }

  app.addHook('onRequest', async (request) => {
    const token = parseAuthHeader(request.headers);
    if (!token) {
      request.userId = undefined;
      return;
    }
    try {
      const payload = await verifyJwtWithIssuerFallback(token, { issuer, audience });
      request.userId = payload.sub;
    } catch (error) {
      request.log.debug({ err: error }, 'JWT verification failed');
      request.userId = undefined;
    }
  });

  const container = createContainer();

  const schema = makeExecutableSchema<GraphQLContext>({
    typeDefs,
    resolvers: createResolvers(container.messaging)
  });

  const mercuriusOptions: MercuriusOptions & { federationMetadata?: boolean } = {
    schema,
    graphiql: process.env.NODE_ENV !== 'production',
    federationMetadata: true,
    context: (request): GraphQLContext => ({ userId: request.userId })
  };

  await app.register(mercurius, mercuriusOptions);

  try {
    await container.messaging.commands.ensureSeedData.execute();
  } catch (error) {
    app.log.error(
      { err: error },
      'Failed to seed messaging data. Ensure database migrations have been applied.'
    );
    throw error;
  }

  app.addHook('onRequest', (request, _, done) => {
    (
      request.log as unknown as {
        setBindings?: (bindings: Record<string, unknown>) => void;
      }
    ).setBindings?.({
      userId: request.userId
    });
    done();
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ready' }));

  return app;
}
