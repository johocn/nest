import { IsString, IsInt, IsOptional, IsEnum } from 'class-validator';
import { Faction } from '@constants/enums';

export class UpdateFactionDto {
  @IsOptional() @IsEnum(Faction) faction?: Faction;
  @IsOptional() @IsString() factionName?: string;
  @IsOptional() @IsInt() factionLevel?: number;
}
