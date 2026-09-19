import { IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class JoinFormationDto {
  @IsString()
  playerId: string;

  @IsInt()
  @Min(1)
  @Max(7)
  @Type(() => Number)
  position: number;
}
