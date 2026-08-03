import {
  IsString,
  IsArray,
  IsNumber,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DropItemEntry {
  @IsString()
  itemTemplateId: string;

  @IsNumber()
  @Min(0)
  weight: number;

  @IsInt()
  @Min(0)
  minQty: number;

  @IsInt()
  @Min(0)
  maxQty: number;
}

export class CreateDropTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DropItemEntry)
  dropItems: DropItemEntry[];

  @IsNumber()
  @Min(0)
  @Max(1)
  dropRate: number;

  @IsInt()
  @Min(1)
  @Max(100)
  maxDrops: number;
}
