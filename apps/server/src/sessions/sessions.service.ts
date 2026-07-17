import { Injectable, NotFoundException } from "@nestjs/common";
import { Message, Session } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { CreateMessageDto } from "./dto/create-message.dto";
import { CreateSessionDto } from "./dto/create-session.dto";

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

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

    const userMessage = await this.prisma.message.create({
      data: { sessionId, role: "user", content: dto.content },
    });

    // TODO: replace with a real LLM call (see docs/PROJECT_SPEC.md requirement 2).
    const replyContent = await this.generateReply(sessionId, dto.content);

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

  private generateReply(_sessionId: string, userContent: string): Promise<string> {
    return Promise.resolve(`Echo: ${userContent}`);
  }
}
