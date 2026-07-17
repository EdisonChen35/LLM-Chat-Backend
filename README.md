# LLM Chat Backend

## Prerequisites

- Node.js v22 or higher
- pnpm v9 or higher

## Quick Start

```
pnpm install
pnpm dev
```

- Feel free to install other dependencies you need.

## Testing

### How to run

```
pnpm --filter server test               # unit tests (fast, no external dependencies)
pnpm --filter server test:e2e           # e2e tests (full HTTP request/response cycle)

# integration tests need a real Postgres:
docker compose up -d --wait db
pnpm --filter server prisma:migrate:deploy
pnpm --filter server test:integration
```

### Strategy

Tests are split into three layers, trading off speed against how much of the real stack they exercise:

- **Unit tests** ([`sessions.service.spec.ts`](apps/server/src/sessions/sessions.service.spec.ts), [`llm.service.spec.ts`](apps/server/src/llm/llm.service.spec.ts)) test business logic in isolation: Prisma query shapes, 404s for unknown sessions, message ordering, and NVIDIA request/response handling in `LlmService` (mocked `fetch`).
- **e2e tests** ([`test/sessions.e2e-spec.ts`](apps/server/test/sessions.e2e-spec.ts)) boot a real Nest app and drive it over HTTP with `supertest`: full session lifecycle (create → list → get → message → delete → 404) and validation errors (400 on empty message content), using an in-memory Prisma fake so they run anywhere with no setup.
- **Integration tests** ([`test/sessions.integration-spec.ts`](apps/server/test/sessions.integration-spec.ts)) run the same HTTP flow against a real `PrismaService` and Postgres (the `db` service in [`docker-compose.yml`](docker-compose.yml)). This is the layer that proves the schema and migrations are correct — notably that deleting a session cascades to its messages via the database's foreign-key constraint, not just application code. The hand-written in-memory fake can't verify that and could silently drift from real Postgres behavior.

**External dependencies are stubbed at the injection boundary, not mocked with a library:**

- **LLM** — `LlmService` normally calls NVIDIA's OpenAI-compatible endpoint; all three layers replace it with `jest.fn()` to avoid real API calls. This also lets us simulate the LLM failure case deterministically: when the provider call fails, `SessionsService.addMessage` still persists the user's message and returns `502` instead of losing the turn — asserted in the unit and e2e tests, and relied on (not re-asserted) in the integration test.
- **Database** — unit tests use a plain `jest.fn()`-based `PrismaService` mock (no I/O). e2e tests use an in-memory fake ([`test/fakes/in-memory-prisma.service.ts`](apps/server/test/fakes/in-memory-prisma.service.ts)) covering the subset of the Prisma API `SessionsService` calls. Integration tests are the only layer against a real database.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lint, build, and all three test layers on every push/PR to `main`.
