import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  content!: string;
}
