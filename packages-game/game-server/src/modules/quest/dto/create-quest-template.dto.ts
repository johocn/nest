import {
  IsString,
  IsEnum,
  IsInt,
  IsBoolean,
  IsOptional,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { QuestType } from '@constants/enums';

export class CreateQuestTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string;

  @IsEnum(QuestType)
  questType: QuestType;

  @IsInt()
  @Min(1)
  minLevel: number;

  @IsInt()
  @Min(1)
  acceptLimit: number;

  @IsBoolean()
  autoReward: boolean;

  @IsOptional()
  targetJson?: Record<string, any>;

  @IsOptional()
  rewardJson?: Record<string, any>;

  @IsOptional()
  prerequisiteIds?: number[];

  @IsBoolean()
  repeatable: boolean;
}
