import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSessionDto {
  @ApiPropertyOptional({ maxLength: 200, example: "Trip planning" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
