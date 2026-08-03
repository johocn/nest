import {
  IsString,
  IsEnum,
  IsInt,
  IsOptional,
  IsObject,
  Min,
} from 'class-validator';
import { AchievementCategory, AchievementCondition } from '@constants/enums';

export class CreateAchievementDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(AchievementCategory)
  category: AchievementCategory;

  @IsEnum(AchievementCondition)
  condition: AchievementCondition;

  @IsInt()
  @Min(1)
  targetValue: number;

  @IsOptional()
  @IsObject()
  rewardJson?: Record<string, any>;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
