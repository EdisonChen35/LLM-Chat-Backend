import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { LlmService } from "../src/llm/llm.service";
import { PrismaService } from "../src/prisma/prisma.service";

interface SessionDto {
  id: string;
  updatedAt: string;
}

interface MessageDto {
  role: string;
  content: string;
}

/**
 * Integration layer: exercises the real PrismaService against the Postgres
 * instance from docker-compose.yml (run `docker compose up -d --wait db` and
 * `pnpm prisma:migrate:deploy` first — see README "Testing"). Only the LLM
 * call is mocked; everything else, including the schema's foreign-key
 * cascade, runs for real. This is what the e2e suite's in-memory Prisma fake
 * can't verify on its own.
 */
describe("Sessions (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmService)
      .useValue({ generateReply: jest.fn().mockResolvedValue("Echo: hi") })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    // Sessions own the messages via onDelete: Cascade, so this alone clears both tables.
    await prisma.session.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it("writes sessions and messages through Prisma and reads them back", async () => {
    const createResponse = await request(app.getHttpServer())
      .post("/sessions")
      .send({ title: "integration session" })
      .expect(201);
    const session = createResponse.body as SessionDto;

    await request(app.getHttpServer())
      .post(`/sessions/${session.id}/messages`)
      .send({ content: "hi" })
      .expect(201);

    // Confirmed at the storage layer directly...
    const storedMessages = await prisma.message.findMany({ where: { sessionId: session.id } });
    expect(storedMessages).toHaveLength(2);
    expect(storedMessages.map((m) => m.role).sort()).toEqual(["assistant", "user"]);

    // ...and through the actual read API against the real database — the
    // e2e suite only exercises GET /sessions/:id/messages against an
    // in-memory fake, never against real Postgres.
    const messagesResponse = await request(app.getHttpServer())
      .get(`/sessions/${session.id}/messages`)
      .expect(200);
    const messages = messagesResponse.body as MessageDto[];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");

    // A successfully completed turn touches the session's updatedAt.
    const sessionResponse = await request(app.getHttpServer())
      .get(`/sessions/${session.id}`)
      .expect(200);
    const updatedSession = sessionResponse.body as SessionDto;
    expect(new Date(updatedSession.updatedAt).getTime()).toBeGreaterThan(
      new Date(session.updatedAt).getTime(),
    );
  });

  it("cascades the delete at the database level, not just through the app", async () => {
    const createResponse = await request(app.getHttpServer())
      .post("/sessions")
      .send({})
      .expect(201);
    const sessionId = (createResponse.body as SessionDto).id;

    await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/messages`)
      .send({ content: "hi" })
      .expect(201);
    await expect(prisma.message.findMany({ where: { sessionId } })).resolves.toHaveLength(2);

    await request(app.getHttpServer()).delete(`/sessions/${sessionId}`).expect(204);

    // Through the app: the session and its message history are both gone.
    await request(app.getHttpServer()).get(`/sessions/${sessionId}/messages`).expect(404);

    // Bypass the app layer entirely: query Prisma directly to confirm the
    // rows are actually gone via the migration's foreign-key constraint,
    // not just unreachable through SessionsService's own 404 guard.
    const remaining = await prisma.message.findMany({ where: { sessionId } });
    expect(remaining).toEqual([]);
  });
});
