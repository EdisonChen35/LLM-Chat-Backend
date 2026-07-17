import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// Documents the shape of a Prisma Session for Swagger — the controller
// still returns the Prisma model directly, this is response-schema-only.
export class SessionDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  title!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}
