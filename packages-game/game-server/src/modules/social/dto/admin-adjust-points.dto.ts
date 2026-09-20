import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminAdjustPointsDto {
  @IsInt()
  @Type(() => Number)
  delta: number;

  @IsOptional()
  @IsString()
  note?: string;
}