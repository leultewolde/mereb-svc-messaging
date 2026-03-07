# svc-messaging

`svc-messaging` is the conversations/messages service. It exposes a federated GraphQL API backed by Prisma/Postgres and seeds baseline conversation data on startup when the database is empty.

## API surface

- GraphQL endpoint: `POST /graphql`
- Health checks:
  - `GET /healthz`
  - `GET /readyz`

Core GraphQL operations:

- queries: `conversations`, `conversation(id)`, `messages(conversationId, after, limit)`
- mutation: `sendMessage(conversationId, toUserId, body)`

`sendMessage` supports:

- existing conversation flow (`conversationId`)
- direct-message bootstrap flow (`toUserId`)

## Runtime notes

- Startup runs `prisma migrate deploy` before serving traffic.
- Startup seeds default conversations/messages when no records exist.

## Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | - | Postgres connection string. |
| `OIDC_ISSUER` | yes | - | JWT issuer. |
| `OIDC_AUDIENCE` | yes | - | JWT audience/client ID. |
| `PORT` | no | `4004` | HTTP listen port. |
| `HOST` | no | `0.0.0.0` | HTTP listen host. |

## Local development

```bash
pnpm --filter @services/svc-messaging dev
pnpm --filter @services/svc-messaging dev:outbox
pnpm --filter @services/svc-messaging build
pnpm --filter @services/svc-messaging start
```

## Tests

```bash
pnpm --filter @services/svc-messaging test
pnpm --filter @services/svc-messaging test:integration
pnpm --filter @services/svc-messaging test:ci
```
