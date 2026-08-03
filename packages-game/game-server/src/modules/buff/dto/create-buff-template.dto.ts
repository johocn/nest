import {
  IsString,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { BuffType, BuffTarget } from '@constants/enums';

export class CreateBuffTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsEnum(BuffType)
  buffType: BuffType;

  @IsEnum(BuffTarget)
  target: BuffTarget;

  @IsInt()
  @Min(1)
  duration: number;

  statModifiers: Record<string, number>;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  iconKey?: string;
}
