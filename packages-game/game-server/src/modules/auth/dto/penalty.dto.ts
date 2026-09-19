import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PenaltyLevel } from '@constants/enums';

export class ApplyPenaltyDto {
  @ApiProperty()
  @IsString()
  playerId: string;

  @ApiProperty()
  @IsString()
  accountId: string;

  @ApiProperty({ enum: PenaltyLevel })
  @IsEnum(PenaltyLevel)
  level: PenaltyLevel;

  @ApiProperty()
  @IsString()
  @Length(1, 255)
  reason: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationSeconds?: number;
}
