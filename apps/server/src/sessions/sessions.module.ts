import { Module } from "@nestjs/common";

import { LlmModule } from "../llm/llm.module";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [LlmModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
