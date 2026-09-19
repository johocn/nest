import { IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class FaceAdjustDto {
  @IsString()
  playerId: string;

  @IsInt()
  @Type(() => Number)
  delta: number;

  @IsString()
  reason: string;
}
