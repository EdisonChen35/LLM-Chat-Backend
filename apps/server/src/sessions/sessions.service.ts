import { BadGatewayException, Injectable, NotFoundException } from "@nestjs/common";
import { Message, Session } from "@prisma/client";

import { LlmService } from "../llm/llm.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateMessageDto } from "./dto/create-message.dto";
import { CreateSessionDto } from "./dto/create-session.dto";

// How many prior turns to send as context, to keep prompts within the
// model's context window on long-running sessions.
const HISTORY_LIMIT = 20;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  createSession(dto: CreateSessionDto): Promise<Session> {
    return this.prisma.session.create({
      data: { title: dto.title ?? null },
    });
  }

  listSessions(): Promise<Session[]> {
    return this.prisma.session.findMany({ orderBy: { updatedAt: "desc" } });
  }

  async getSession(id: string): Promise<Session> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (session === null) {
      throw new NotFoundException(`Session ${id} not found`);
    }
    return session;
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    await this.getSession(sessionId);
    return this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
  }

  async addMessage(
    sessionId: string,
    dto: CreateMessageDto,
  ): Promise<{ userMessage: Message; assistantMessage: Message }> {
    await this.getSession(sessionId);

    const priorMessages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      take: -HISTORY_LIMIT,
    });

    const userMessage = await this.prisma.message.create({
      data: { sessionId, role: "user", content: dto.content },
    });

    let replyContent: string;
    try {
      replyContent = await this.llmService.generateReply([
        ...priorMessages.map(({ role, content }) => ({ role, content })),
        { role: "user", content: dto.content },
      ]);
    } catch {
      // The user's message is already persisted, so the conversation history
      // isn't lost even though we couldn't get a reply this time.
      throw new BadGatewayException("Failed to generate a reply from the LLM service");
    }

    const assistantMessage = await this.prisma.message.create({
      data: { sessionId, role: "assistant", content: replyContent },
    });

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return { userMessage, assistantMessage };
  }

  async deleteSession(id: string): Promise<void> {
    await this.getSession(id);
    await this.prisma.session.delete({ where: { id } });
  }
}
