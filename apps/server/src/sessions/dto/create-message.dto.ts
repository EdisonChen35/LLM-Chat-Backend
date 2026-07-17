import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateMessageDto {
  @ApiProperty({ maxLength: 8000, example: "What's the capital of France?" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  content!: string;
}
