import { IsEnum, IsString } from 'class-validator';
import { GuildBuildingType } from '@constants/enums';

export class BuildGuildBuildingDto {
  @IsString()
  guildId: string;

  @IsEnum(GuildBuildingType)
  buildingType: GuildBuildingType;
}
