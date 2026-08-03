import {
  IsString,
  IsEnum,
  IsInt,
  IsOptional,
  MinLength,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Profession, Gender } from '@constants/enums';

export class CreateCharacterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(16)
  nickname: string;

  @IsEnum(Profession)
  profession: Profession;

  @IsEnum(Gender)
  gender: Gender;

  @IsInt()
  @Min(1)
  @Max(150)
  age: number;

  @IsOptional()
  @IsString()
  birthday?: string;
}
