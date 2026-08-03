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

export class AdminCreateTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsEnum(ItemType)
  itemType: ItemType;

  @IsEnum(ItemRarity)
  rarity: ItemRarity;

  @IsInt()
  @Min(1)
  @Max(9999)
  maxStack: number;

  @IsString()
  sellPrice: string;

  @IsBoolean()
  canTrade: boolean;

  @IsBoolean()
  canDrop: boolean;

  @IsEnum(BindType)
  bindType: BindType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  configJson?: Record<string, any>;
}
