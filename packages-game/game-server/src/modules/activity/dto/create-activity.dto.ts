import {
  IsString,
  IsEnum,
  IsDateString,
  IsInt,
  IsOptional,
  IsObject,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ActivityType, SignInCycle } from '@constants/enums';

export class CreateActivityDto {
  @IsString()
  name: string;

  @IsEnum(ActivityType)
  activityType: ActivityType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  @Type(() => Date)
  startAt: Date;

  @IsDateString()
  @Type(() => Date)
  endAt: Date;

  @IsOptional()
  @IsEnum(SignInCycle)
  signInCycle?: SignInCycle;

  @IsOptional()
  @IsObject()
  rewardJson?: Record<string, any>;

  @IsOptional()
  @IsObject()
  conditionJson?: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxParticipants?: number;
}
