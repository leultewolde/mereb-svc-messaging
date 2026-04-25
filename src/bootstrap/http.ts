import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyPluginCallback,
  type FastifyPluginOptions,
  type FastifyTypeProviderDefault,
  type RawServerDefault
} from 'fastify';
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

type AppPlugin =
  | FastifyPluginCallback<
      FastifyPluginOptions,
      RawServerDefault,
      FastifyTypeProviderDefault,
      FastifyBaseLogger
    >
  | FastifyPluginAsync<
      FastifyPluginOptions,
      RawServerDefault,
      FastifyTypeProviderDefault,
      FastifyBaseLogger
    >;

type RequestWithUserId = {
  userId?: string;
};

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

function readRequestUserId(request: object): string | undefined {
  return (request as RequestWithUserId).userId;
}

function writeRequestUserId(
  request: object,
  userId: string | undefined
): void {
  (request as RequestWithUserId).userId = userId;
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createFastifyLoggerOptions('svc-messaging')
  }).withTypeProvider<FastifyTypeProviderDefault>();

  const registerPlugin = async (
    plugin: AppPlugin,
    options?: FastifyPluginOptions
  ): Promise<void> => {
    if (options !== undefined) {
      await app.register(plugin, options);
      return;
    }

    await app.register(plugin);
  };

  await registerPlugin(helmet as unknown as AppPlugin);
  await registerPlugin(
    cors as unknown as AppPlugin,
    { origin: true, credentials: true }
  );
  await registerPlugin(sensible as unknown as AppPlugin);
  await registerPlugin(underPressure as unknown as AppPlugin);

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
      writeRequestUserId(request, undefined);
      return;
    }
    try {
      const payload = await verifyJwtWithIssuerFallback(token, { issuer, audience });
      writeRequestUserId(request, payload.sub);
    } catch (error) {
      request.log.debug({ err: error }, 'JWT verification failed');
      writeRequestUserId(request, undefined);
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
    context: (request): GraphQLContext => ({
      userId: readRequestUserId(request),
      pubsub: app.graphql.pubsub
    }),
    subscription: {
      context: async (_socket, request): Promise<GraphQLContext> => {
        const token = parseAuthHeader(request.headers);
        if (!token) {
          throw new Error('Authentication required');
        }

        const payload = await verifyJwtWithIssuerFallback(token, { issuer, audience });
        return {
          userId: payload.sub,
          pubsub: app.graphql.pubsub
        };
      }
    }
  };

  await registerPlugin(
    mercurius as unknown as AppPlugin,
    mercuriusOptions as FastifyPluginOptions
  );

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
      userId: readRequestUserId(request)
    });
    done();
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ready' }));

  return app;
}
