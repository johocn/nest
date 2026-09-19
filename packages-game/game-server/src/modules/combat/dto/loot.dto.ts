import { IsString, IsEnum, IsOptional, IsObject } from 'class-validator';
import { LootDistributionMode } from '@constants/enums';

export class LootDto {
  @IsString()
  combatLogId: string;

  @IsEnum(LootDistributionMode)
  mode: LootDistributionMode;

  @IsOptional()
  @IsObject()
  itemsJson?: Record<string, any>;
}
