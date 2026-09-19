import { IsEnum, IsISO8601, IsString } from 'class-validator';
import { GuildActivityType } from '@constants/enums';

export class CreateGuildActivityDto {
  @IsString()
  guildId: string;

  @IsEnum(GuildActivityType)
  activityType: GuildActivityType;

  @IsISO8601()
  scheduleAt: string;
}
