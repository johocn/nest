import {
  IsString,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { SkillType, MartialArtType } from '@constants/enums';

export class CreateSkillTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  @IsEnum(SkillType)
  skillType: SkillType;

  @IsOptional()
  @IsEnum(MartialArtType)
  artType?: MartialArtType;

  @IsInt()
  @Min(0)
  baseDamage: number;

  @IsInt()
  @Min(0)
  cooldown: number;

  @IsInt()
  @Min(0)
  mpCost: number;

  @IsInt()
  @Min(1)
  range: number;

  @IsOptional()
  effectJson?: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Min(1)
  minLevel?: number;
}
