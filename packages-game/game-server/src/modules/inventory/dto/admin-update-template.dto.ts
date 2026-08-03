import {
  IsString,
  IsEnum,
  IsInt,
  IsBoolean,
  IsOptional,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ItemType, ItemRarity, BindType } from '@constants/enums';

export class AdminUpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsEnum(ItemType)
  itemType?: ItemType;

  @IsOptional()
  @IsEnum(ItemRarity)
  rarity?: ItemRarity;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  maxStack?: number;

  @IsOptional()
  @IsString()
  sellPrice?: string;

  @IsOptional()
  @IsBoolean()
  canTrade?: boolean;

  @IsOptional()
  @IsBoolean()
  canDrop?: boolean;

  @IsOptional()
  @IsEnum(BindType)
  bindType?: BindType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  configJson?: Record<string, any>;
}
