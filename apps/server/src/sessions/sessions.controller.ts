import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { Message, Session } from "@prisma/client";

import { CreateMessageDto } from "./dto/create-message.dto";
import { CreateSessionDto } from "./dto/create-session.dto";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  createSession(@Body() dto: CreateSessionDto): Promise<Session> {
    return this.sessionsService.createSession(dto);
  }

  @Get()
  listSessions(): Promise<Session[]> {
    return this.sessionsService.listSessions();
  }

  @Get(":id")
  getSession(@Param("id") id: string): Promise<Session> {
    return this.sessionsService.getSession(id);
  }

  @Get(":id/messages")
  listMessages(@Param("id") id: string): Promise<Message[]> {
    return this.sessionsService.listMessages(id);
  }

  @Post(":id/messages")
  addMessage(
    @Param("id") id: string,
    @Body() dto: CreateMessageDto,
  ): Promise<{ userMessage: Message; assistantMessage: Message }> {
    return this.sessionsService.addMessage(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(@Param("id") id: string): Promise<void> {
    await this.sessionsService.deleteSession(id);
  }
}
