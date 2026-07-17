import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { LlmService } from "../src/llm/llm.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { InMemoryPrismaService } from "./fakes/in-memory-prisma.service";

interface SessionDto {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessageDto {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
}

describe("Sessions API (e2e)", () => {
  let app: INestApplication;
  let llm: { generateReply: jest.Mock; streamReply: jest.Mock };

  beforeAll(async () => {
    llm = {
      generateReply: jest.fn().mockResolvedValue("Echo: hi"),
      streamReply: jest.fn(async (_messages: unknown, onToken: (token: string) => void) => {
        onToken("Echo: ");
        onToken("hi");
        return "Echo: hi";
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(new InMemoryPrismaService())
      .overrideProvider(LlmService)
      .useValue(llm)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns ok", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("supports the full session lifecycle", async () => {
    const createResponse = await request(app.getHttpServer())
      .post("/sessions")
      .send({ title: "e2e session" })
      .expect(201);
    const session = createResponse.body as SessionDto;
    expect(session.id).toEqual(expect.any(String));
    expect(session.title).toBe("e2e session");

    const listResponse = await request(app.getHttpServer()).get("/sessions").expect(200);
    const sessions = listResponse.body as SessionDto[];
    expect(sessions.some((s) => s.id === session.id)).toBe(true);

    await request(app.getHttpServer()).get(`/sessions/${session.id}`).expect(200);

    const emptyMessages = await request(app.getHttpServer())
      .get(`/sessions/${session.id}/messages`)
      .expect(200);
    expect(emptyMessages.body).toEqual([]);

    const messageResponse = await request(app.getHttpServer())
      .post(`/sessions/${session.id}/messages`)
      .send({ content: "hi" })
      .expect(201);
    // Only the assistant's reply comes back — the client already knows what
    // it just sent, so the response doesn't echo the user message too.
    const assistantMessage = messageResponse.body as MessageDto;
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toBe("Echo: hi");

    const messagesResponse = await request(app.getHttpServer())
      .get(`/sessions/${session.id}/messages`)
      .expect(200);
    expect(messagesResponse.body).toHaveLength(2);

    await request(app.getHttpServer()).delete(`/sessions/${session.id}`).expect(204);
    await request(app.getHttpServer()).get(`/sessions/${session.id}`).expect(404);
  });

  it("returns 400 when message content is empty", async () => {
    const { body: session } = await request(app.getHttpServer())
      .post("/sessions")
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post(`/sessions/${(session as SessionDto).id}/messages`)
      .send({ content: "" })
      .expect(400);
  });

  it("returns 404 for an unknown session", async () => {
    await request(app.getHttpServer()).get("/sessions/does-not-exist").expect(404);
    await request(app.getHttpServer())
      .post("/sessions/does-not-exist/messages")
      .send({ content: "hi" })
      .expect(404);
  });

  // Boundary case for LLM integration: the provider fails for this one call.
  it("returns 502 but keeps the user message when the LLM call fails", async () => {
    const { body: session } = await request(app.getHttpServer())
      .post("/sessions")
      .send({})
      .expect(201);
    const sessionId = (session as SessionDto).id;

    llm.generateReply.mockRejectedValueOnce(new Error("provider timeout"));

    await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/messages`)
      .send({ content: "hi" })
      .expect(502);

    const messagesResponse = await request(app.getHttpServer())
      .get(`/sessions/${sessionId}/messages`)
      .expect(200);
    const messages = messagesResponse.body as MessageDto[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  describe("POST /sessions/:id/messages/stream", () => {
    it("streams tokens over SSE and persists both messages", async () => {
      const { body: session } = await request(app.getHttpServer())
        .post("/sessions")
        .send({})
        .expect(201);
      const sessionId = (session as SessionDto).id;

      const response = await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/messages/stream`)
        .send({ content: "hi" })
        .expect(200);

      expect(response.headers["content-type"]).toContain("text/event-stream");
      expect(response.text).toContain('event: token\ndata: {"content":"Echo: "}');
      expect(response.text).toContain('event: token\ndata: {"content":"hi"}');
      expect(response.text).toContain("event: done");

      const messagesResponse = await request(app.getHttpServer())
        .get(`/sessions/${sessionId}/messages`)
        .expect(200);
      const messages = messagesResponse.body as MessageDto[];
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toBe("Echo: hi");
    });

    it("returns a normal 404 for an unknown session (not an event stream)", async () => {
      const response = await request(app.getHttpServer())
        .post("/sessions/does-not-exist/messages/stream")
        .send({ content: "hi" })
        .expect(404);
      expect(response.headers["content-type"]).toContain("application/json");
    });

    // Boundary case for LLM integration: since SSE headers are already sent
    // by the time the provider fails, the failure surfaces as an `error`
    // event rather than an HTTP status code — but the user message is still
    // persisted, same contract as the non-streaming endpoint.
    it("emits an error event but keeps the user message when the stream fails", async () => {
      const { body: session } = await request(app.getHttpServer())
        .post("/sessions")
        .send({})
        .expect(201);
      const sessionId = (session as SessionDto).id;

      llm.streamReply.mockRejectedValueOnce(new Error("provider timeout"));

      const response = await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/messages/stream`)
        .send({ content: "hi" })
        .expect(200);
      expect(response.text).toContain("event: error");

      const messagesResponse = await request(app.getHttpServer())
        .get(`/sessions/${sessionId}/messages`)
        .expect(200);
      const messages = messagesResponse.body as MessageDto[];
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });
  });
});
