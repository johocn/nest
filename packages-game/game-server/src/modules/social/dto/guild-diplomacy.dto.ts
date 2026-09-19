import { IsEnum, IsString } from 'class-validator';
import { GuildDiplomacyRelation } from '@constants/enums';

export class SetDiplomacyDto {
  @IsString()
  guildId: string;

  @IsString()
  targetGuildId: string;

  @IsEnum(GuildDiplomacyRelation)
  relation: GuildDiplomacyRelation;
}
