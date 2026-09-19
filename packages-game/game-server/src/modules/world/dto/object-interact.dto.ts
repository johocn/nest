import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { InteractType } from '@constants/enums';

export class ObjectInteractDto {
  @ApiProperty({ enum: InteractType })
  @IsEnum(InteractType)
  interactType: InteractType;
}

export class TriggerActivateDto {
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memberIds?: string[];
}

export class MountActionDto {
  @ApiProperty()
  @IsString()
  mountId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  ride?: boolean;
}

export class StartGameDto {
  @ApiProperty()
  @IsString()
  gameId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  betAmount: number;
}

export class BetGameDto {
  @ApiProperty()
  @IsString()
  sessionId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  betAmount: number;
}

export class FinishGameDto {
  @ApiProperty()
  @IsString()
  sessionId: string;

  @ApiProperty()
  @IsString()
  winnerPlayerId: string;
}

export class LandmarkMessageDto {
  @ApiProperty()
  @IsString()
  @Length(1, 100)
  content: string;
}
