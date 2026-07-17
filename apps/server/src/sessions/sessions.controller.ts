import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Message, Session } from "@prisma/client";
import { Response } from "express";

import { CreateMessageDto } from "./dto/create-message.dto";
import { CreateSessionDto } from "./dto/create-session.dto";
import { MessageDto } from "./dto/message.dto";
import { SessionDto } from "./dto/session.dto";
import { SessionsService } from "./sessions.service";

@ApiTags("sessions")
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @ApiOperation({ summary: "Create a new chat session" })
  @ApiResponse({ status: 201, type: SessionDto })
  createSession(@Body() dto: CreateSessionDto): Promise<Session> {
    return this.sessionsService.createSession(dto);
  }

  @Get()
  @ApiOperation({ summary: "List all sessions, most recently active first" })
  @ApiResponse({ status: 200, type: [SessionDto] })
  listSessions(): Promise<Session[]> {
    return this.sessionsService.listSessions();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single session" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: SessionDto })
  @ApiResponse({ status: 404, description: "Session not found" })
  getSession(@Param("id") id: string): Promise<Session> {
    return this.sessionsService.getSession(id);
  }

  @Get(":id/messages")
  @ApiOperation({ summary: "Get a session's message history, oldest first" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: [MessageDto] })
  @ApiResponse({ status: 404, description: "Session not found" })
  listMessages(@Param("id") id: string): Promise<Message[]> {
    return this.sessionsService.listMessages(id);
  }

  @Post(":id/messages")
  @ApiOperation({ summary: "Add a message and get the LLM's reply" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 201, type: MessageDto, description: "The assistant's reply" })
  @ApiResponse({ status: 404, description: "Session not found" })
  @ApiResponse({ status: 502, description: "LLM call failed" })
  addMessage(@Param("id") id: string, @Body() dto: CreateMessageDto): Promise<Message> {
    return this.sessionsService.addMessage(id, dto);
  }

  // Streaming counterpart to POST :id/messages: same request body, but the
  // reply arrives as Server-Sent Events (`token` per chunk, then `done` with
  // the final assistant message, or `error` if the LLM call failed).
  @Post(":id/messages/stream")
  @ApiOperation({
    summary: "Add a message and stream the LLM's reply over Server-Sent Events",
    description:
      "Same request body as POST :id/messages. Response is text/event-stream: " +
      '`event: token` per chunk (`data: {"content": "..."}`), then a final ' +
      "`event: done` with the assistant's message, or `event: error` if the LLM " +
      "call failed partway through. A missing session still returns a normal 404 " +
      "JSON response, not an event stream.",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiProduces("text/event-stream")
  @ApiResponse({ status: 200, description: "SSE stream of token/done/error events" })
  @ApiResponse({ status: 404, description: "Session not found" })
  async streamMessage(
    @Param("id") id: string,
    @Body() dto: CreateMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    // Resolved before any SSE headers are written, so a missing session is
    // still a normal 404 JSON response rather than something we'd have to
    // encode inside an already-started event stream.
    await this.sessionsService.getSession(id);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const send = (event: string, data: unknown): void => {
      if (res.writableEnded) {
        return;
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const assistantMessage = await this.sessionsService.streamMessage(id, dto, (token) =>
        send("token", { content: token }),
      );
      send("done", assistantMessage);
    } catch {
      send("error", { message: "Failed to generate a reply from the LLM service" });
    } finally {
      res.end();
    }
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a session and its messages" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 204, description: "Deleted" })
  @ApiResponse({ status: 404, description: "Session not found" })
  async deleteSession(@Param("id") id: string): Promise<void> {
    await this.sessionsService.deleteSession(id);
  }
}
