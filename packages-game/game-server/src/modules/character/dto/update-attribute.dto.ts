import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateAttributeDto {
  @IsOptional() @IsInt() @Min(0) strength?: number;
  @IsOptional() @IsInt() @Min(0) speed?: number;
  @IsOptional() @IsInt() @Min(0) defense?: number;
  @IsOptional() @IsInt() @Min(0) intelligence?: number;
  @IsOptional() @IsInt() @Min(0) comprehension?: number;
  @IsOptional() @IsInt() @Min(0) loyalty?: number;
  @IsOptional() @IsString() combatPower?: string; // bigint as string
}
