FROM registry.leultewolde.com/mereb/mereb-node-base:v0.0.4 AS base

COPY package.json pnpm-lock.yaml ./
COPY prisma prisma
COPY schema.graphql schema.graphql
COPY src src
COPY tsconfig.base.json tsconfig.base.json
COPY tsconfig.json tsconfig.json
COPY tsconfig.eslint.json tsconfig.eslint.json
COPY docker-entrypoint.sh docker-entrypoint.sh

RUN pnpm install --frozen-lockfile && \
    pnpm run prisma:generate && \
    pnpm run build

CMD ["sh", "docker-entrypoint.sh"]
