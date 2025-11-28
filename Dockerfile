FROM node:20-alpine AS base
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json pnpm-lock.yaml ./
COPY schema.graphql schema.graphql
COPY src src
COPY tsconfig.base.json tsconfig.base.json
COPY tsconfig.json tsconfig.json

RUN corepack enable && \
    pnpm install --frozen-lockfile && \
    pnpm run build

CMD ["node", "dist/index.js"]
