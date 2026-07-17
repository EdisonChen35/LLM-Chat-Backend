import { ApiProperty } from "@nestjs/swagger";

// Documents the shape of a Prisma Message for Swagger — the controller
// still returns the Prisma model directly, this is response-schema-only.
export class MessageDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  sessionId!: string;

  @ApiProperty({ enum: ["user", "assistant", "system"] })
  role!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;
}
