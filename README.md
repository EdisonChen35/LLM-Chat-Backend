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

## API Documentation

Interactive OpenAPI docs (Swagger UI) are served at **http://localhost:3000/docs** once the server is running — covers every endpoint, request/response schemas, and status codes.

## LLM Provider

`LlmService` ([`llm.service.ts`](apps/server/src/llm/llm.service.ts)) talks to any OpenAI-compatible `/v1/chat/completions` endpoint, configured via three env vars (see [`.env.example`](apps/server/.env.example)):

| Var | Purpose | Default |
|---|---|---|
| `LLM_API_URL` | Chat completions endpoint | NVIDIA's hosted endpoint |
| `LLM_API_KEY` | Bearer token; omit for providers that don't need one | — |
| `LLM_MODEL` | Model name | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` |

### NVIDIA hosted models (default)

Free, OpenAI-compatible: https://build.nvidia.com/models. Set `LLM_API_KEY` to a key from there — `LLM_API_URL`/`LLM_MODEL` already default to NVIDIA.

### Local LLM via Ollama

1. Install [Ollama](https://ollama.com) and pull a small model: `ollama pull llama3.2:1b`
2. In `apps/server/.env`:
   ```
   LLM_API_URL="http://localhost:11434/v1/chat/completions"
   LLM_MODEL="llama3.2:1b"
   ```
   (leave `LLM_API_KEY` unset — Ollama doesn't need one)

No code changes needed to switch between the two — both speak the same request/response shape.

### Streaming

`POST /sessions/:id/messages/stream` is the streaming counterpart to `POST /sessions/:id/messages` — same request body, but the reply arrives as Server-Sent Events instead of one JSON blob:

```
curl -N -X POST http://localhost:3000/sessions/<id>/messages/stream \
  -H "Content-Type: application/json" \
  -d '{"content":"hi"}'
```

- `event: token` — one per chunk, `data: {"content": "..."}`
- `event: done` — once the reply is fully generated and persisted, `data` has the final `userMessage`/`assistantMessage` (same shape as the non-streaming endpoint)
- `event: error` — if the LLM call fails mid-stream

Chosen over WebSocket because the data only flows one way (server → client) and this fits directly into the existing REST resource model instead of needing a separate gateway/connection-management layer — see [`sessions.controller.ts`](apps/server/src/sessions/sessions.controller.ts).

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

- **Unit tests** ([`sessions.service.spec.ts`](apps/server/src/sessions/sessions.service.spec.ts), [`llm.service.spec.ts`](apps/server/src/llm/llm.service.spec.ts)) test business logic in isolation: Prisma query shapes, 404s for unknown sessions, message ordering, and the chat completions request/response handling in `LlmService` (mocked `fetch`).
- **e2e tests** ([`test/sessions.e2e-spec.ts`](apps/server/test/sessions.e2e-spec.ts)) boot a real Nest app and drive it over HTTP with `supertest`: full session lifecycle (create → list → get → message → delete → 404) and validation errors (400 on empty message content), using an in-memory Prisma fake so they run anywhere with no setup.
- **Integration tests** ([`test/sessions.integration-spec.ts`](apps/server/test/sessions.integration-spec.ts)) run the same HTTP flow against a real `PrismaService` and Postgres (the `db` service in [`docker-compose.yml`](docker-compose.yml)). This is the layer that proves the schema and migrations are correct — notably that deleting a session cascades to its messages via the database's foreign-key constraint, not just application code. The hand-written in-memory fake can't verify that and could silently drift from real Postgres behavior.

**External dependencies are stubbed at the injection boundary, not mocked with a library:**

- **LLM** — `LlmService` normally calls a real OpenAI-compatible endpoint (NVIDIA or local Ollama); all three layers replace it with `jest.fn()` to avoid real API calls. This also lets us simulate the LLM failure case deterministically: when the provider call fails, `SessionsService.addMessage` still persists the user's message and returns `502` instead of losing the turn — asserted in the unit and e2e tests, and relied on (not re-asserted) in the integration test.
- **Database** — unit tests use a plain `jest.fn()`-based `PrismaService` mock (no I/O). e2e tests use an in-memory fake ([`test/fakes/in-memory-prisma.service.ts`](apps/server/test/fakes/in-memory-prisma.service.ts)) covering the subset of the Prisma API `SessionsService` calls. Integration tests are the only layer against a real database.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lint, build, and all three test layers on every push/PR to `main`.
