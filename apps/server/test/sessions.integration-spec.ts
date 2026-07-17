import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { LlmService } from "../src/llm/llm.service";
import { PrismaService } from "../src/prisma/prisma.service";

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
    const sessionId = (createResponse.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/messages`)
      .send({ content: "hi" })
      .expect(201);

    const storedMessages = await prisma.message.findMany({ where: { sessionId } });
    expect(storedMessages).toHaveLength(2);
    expect(storedMessages.map((m) => m.role).sort()).toEqual(["assistant", "user"]);
  });

  it("cascades the delete at the database level, not just through the app", async () => {
    const createResponse = await request(app.getHttpServer())
      .post("/sessions")
      .send({})
      .expect(201);
    const sessionId = (createResponse.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/messages`)
      .send({ content: "hi" })
      .expect(201);
    await expect(prisma.message.findMany({ where: { sessionId } })).resolves.toHaveLength(2);

    await request(app.getHttpServer()).delete(`/sessions/${sessionId}`).expect(204);

    // Bypass the app layer entirely: query Prisma directly to confirm the
    // rows are actually gone via the migration's foreign-key constraint,
    // not just unreachable through SessionsService's own 404 guard.
    const remaining = await prisma.message.findMany({ where: { sessionId } });
    expect(remaining).toEqual([]);
  });
});
