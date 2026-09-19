import { IsEnum, IsString } from 'class-validator';
import { GuildShopRewardType } from '@constants/enums';

export class ExchangeGuildShopDto {
  @IsString()
  guildId: string;

  @IsEnum(GuildShopRewardType)
  rewardType: GuildShopRewardType;
}
