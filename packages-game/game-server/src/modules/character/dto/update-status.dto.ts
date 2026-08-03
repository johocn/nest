import { IsInt, IsString, IsBoolean, IsOptional, Min } from 'class-validator';

export class UpdateStatusDto {
  @IsOptional() @IsInt() @Min(0) health?: number;
  @IsOptional() @IsString() wealth?: string; // bigint as string
  @IsOptional() @IsInt() reputation?: number;
  @IsOptional() @IsBoolean() isAlive?: boolean;
  @IsOptional() @IsString() deathCause?: string;
  @IsOptional() @IsInt() @Min(1) season?: number;
}
