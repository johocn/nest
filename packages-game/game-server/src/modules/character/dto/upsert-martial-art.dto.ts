import { IsEnum, IsInt, IsOptional, Min, Max } from 'class-validator';
import { MartialArtType } from '@constants/enums';

export class UpsertMartialArtDto {
  @IsEnum(MartialArtType)
  artType: MartialArtType;

  @IsInt()
  @Min(0)
  @Max(100)
  level: number;

  @IsOptional()
  skills?: any;
}
