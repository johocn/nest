import { IsEnum, IsString } from 'class-validator';
import { GuildRole } from '@constants/enums';

export class SetGuildRoleDto {
  @IsString()
  guildId: string;

  @IsString()
  playerId: string;

  @IsEnum(GuildRole)
  role: GuildRole;
}
