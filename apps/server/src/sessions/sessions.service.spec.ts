import { BadGatewayException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Message, Session } from "@prisma/client";

import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { SessionsService } from "./sessions.service";

const SESSION_ID = "session-1";

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: SESSION_ID,
  title: "Test session",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: "message-1",
  sessionId: SESSION_ID,
  role: "user",
  content: "hello",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("SessionsService", () => {
  let service: SessionsService;
  let prisma: {
    session: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    message: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let llm: { generateReply: jest.Mock; streamReply: jest.Mock };

  beforeEach(async () => {
    prisma = {
      session: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      message: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    llm = { generateReply: jest.fn(), streamReply: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LlmService, useValue: llm },
      ],
    }).compile();

    service = module.get(SessionsService);
  });

  describe("createSession", () => {
    it("creates a session with the given title", async () => {
      const session = makeSession();
      prisma.session.create.mockResolvedValue(session);

      const result = await service.createSession({ title: "Test session" });

      expect(prisma.session.create).toHaveBeenCalledWith({
        data: { title: "Test session" },
      });
      expect(result).toBe(session);
    });

    it("defaults title to null when omitted", async () => {
      prisma.session.create.mockResolvedValue(makeSession({ title: null }));

      await service.createSession({});

      expect(prisma.session.create).toHaveBeenCalledWith({ data: { title: null } });
    });
  });

  describe("listSessions", () => {
    it("orders sessions by updatedAt desc", async () => {
      prisma.session.findMany.mockResolvedValue([]);

      await service.listSessions();

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        orderBy: { updatedAt: "desc" },
      });
    });
  });

  describe("getSession", () => {
    it("returns the session when found", async () => {
      const session = makeSession();
      prisma.session.findUnique.mockResolvedValue(session);

      await expect(service.getSession(SESSION_ID)).resolves.toBe(session);
    });

    it("throws NotFoundException when the session does not exist", async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(service.getSession("missing")).rejects.toThrow(NotFoundException);
    });
  });

  describe("listMessages", () => {
    it("throws NotFoundException when the session does not exist", async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(service.listMessages("missing")).rejects.toThrow(NotFoundException);
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it("returns messages ordered by createdAt asc", async () => {
      prisma.session.findUnique.mockResolvedValue(makeSession());
      prisma.message.findMany.mockResolvedValue([makeMessage()]);

      const result = await service.listMessages(SESSION_ID);

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { sessionId: SESSION_ID },
        orderBy: { createdAt: "asc" },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("addMessage", () => {
    it("throws NotFoundException when the session does not exist", async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(service.addMessage("missing", { content: "hi" })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.message.findMany).not.toHaveBeenCalled();
      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(llm.generateReply).not.toHaveBeenCalled();
    });

    it("persists the user message, gets an LLM reply, and touches the session", async () => {
      prisma.session.findUnique.mockResolvedValue(makeSession());
      prisma.message.findMany.mockResolvedValue([]);
      const userMessage = makeMessage({ id: "user-msg", role: "user", content: "hi" });
      const assistantMessage = makeMessage({
        id: "assistant-msg",
        role: "assistant",
        content: "Echo: hi",
      });
      prisma.message.create
        .mockResolvedValueOnce(userMessage)
        .mockResolvedValueOnce(assistantMessage);
      llm.generateReply.mockResolvedValue("Echo: hi");

      const result = await service.addMessage(SESSION_ID, { content: "hi" });

      expect(prisma.message.create).toHaveBeenNthCalledWith(1, {
        data: { sessionId: SESSION_ID, role: "user", content: "hi" },
      });
      expect(llm.generateReply).toHaveBeenCalledWith([{ role: "user", content: "hi" }]);
      expect(prisma.message.create).toHaveBeenNthCalledWith(2, {
        data: { sessionId: SESSION_ID, role: "assistant", content: "Echo: hi" },
      });
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: SESSION_ID },
        data: { updatedAt: expect.any(Date) },
      });
      // Only the assistant's reply comes back — the caller already knows
      // what it just sent, so echoing the user message back is redundant.
      expect(result).toEqual(assistantMessage);
    });

    it("sends prior conversation history to the LLM ahead of the new message", async () => {
      prisma.session.findUnique.mockResolvedValue(makeSession());
      prisma.message.findMany.mockResolvedValue([
        makeMessage({ id: "m1", role: "user", content: "first" }),
        makeMessage({ id: "m2", role: "assistant", content: "Echo: first" }),
      ]);
      prisma.message.create
        .mockResolvedValueOnce(makeMessage({ id: "user-msg", role: "user", content: "second" }))
        .mockResolvedValueOnce(
          makeMessage({ id: "assistant-msg", role: "assistant", content: "Echo: second" }),
        );
      llm.generateReply.mockResolvedValue("Echo: second");

      await service.addMessage(SESSION_ID, { content: "second" });

      expect(llm.generateReply).toHaveBeenCalledWith([
        { role: "user", content: "first" },
        { role: "assistant", content: "Echo: first" },
        { role: "user", content: "second" },
      ]);
    });

    // Boundary case for LLM integration: the provider call fails.
    it("keeps the user message but surfaces a 502 when the LLM call fails", async () => {
      prisma.session.findUnique.mockResolvedValue(makeSession());
      prisma.message.findMany.mockResolvedValue([]);
      const userMessage = makeMessage({ id: "user-msg", role: "user", content: "hi" });
      prisma.message.create.mockResolvedValueOnce(userMessage);
      llm.generateReply.mockRejectedValue(new Error("provider timeout"));

      await expect(service.addMessage(SESSION_ID, { content: "hi" })).rejects.toThrow(
        BadGatewayException,
      );

      expect(prisma.message.create).toHaveBeenCalledTimes(1);
      expect(prisma.session.update).not.toHaveBeenCalled();
    });
  });

  describe("streamMessage", () => {
    it("forwards tokens via the callback and persists the full reply", async () => {
      prisma.session.findUnique.mockResolvedValue(makeSession());
      prisma.message.findMany.mockResolvedValue([]);
      const userMessage = makeMessage({ id: "user-msg", role: "user", content: "hi" });
      const assistantMessage = makeMessage({
        id: "assistant-msg",
        role: "assistant",
        content: "Echo: hi",
      });
      prisma.message.create
        .mockResolvedValueOnce(userMessage)
        .mockResolvedValueOnce(assistantMessage);
      llm.streamReply.mockImplementation(
        async (_messages: unknown, onToken: (token: string) => void) => {
          onToken("Echo: ");
          onToken("hi");
          return "Echo: hi";
        },
      );

      const onToken = jest.fn();
      const result = await service.streamMessage(SESSION_ID, { content: "hi" }, onToken);

      expect(onToken.mock.calls).toEqual([["Echo: "], ["hi"]]);
      expect(prisma.message.create).toHaveBeenNthCalledWith(2, {
        data: { sessionId: SESSION_ID, role: "assistant", content: "Echo: hi" },
      });
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: SESSION_ID },
        data: { updatedAt: expect.any(Date) },
      });
      expect(result).toEqual(assistantMessage);
    });

    // Boundary case for LLM integration: same failure contract as addMessage.
    it("keeps the user message but surfaces a 502 when the stream fails", async () => {
      prisma.session.findUnique.mockResolvedValue(makeSession());
      prisma.message.findMany.mockResolvedValue([]);
      prisma.message.create.mockResolvedValueOnce(
        makeMessage({ id: "user-msg", role: "user", content: "hi" }),
      );
      llm.streamReply.mockRejectedValue(new Error("provider timeout"));

      await expect(service.streamMessage(SESSION_ID, { content: "hi" }, jest.fn())).rejects.toThrow(
        BadGatewayException,
      );

      expect(prisma.message.create).toHaveBeenCalledTimes(1);
      expect(prisma.session.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteSession", () => {
    it("throws NotFoundException when the session does not exist", async () => {
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(service.deleteSession("missing")).rejects.toThrow(NotFoundException);
      expect(prisma.session.delete).not.toHaveBeenCalled();
    });

    it("deletes the session when it exists", async () => {
      prisma.session.findUnique.mockResolvedValue(makeSession());

      await service.deleteSession(SESSION_ID);

      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { id: SESSION_ID } });
    });
  });
});
