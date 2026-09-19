import {
  IsString,
  IsEnum,
  IsDate,
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

  @IsDate()
  @Type(() => Date)
  startAt: Date;

  @IsDate()
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
