import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Region } from '@constants/enums';

export class UpdateLocationDto {
  @IsOptional() @IsString() mapId?: string;
  @IsOptional() @IsString() landId?: string;
  @IsOptional() @IsEnum(Region) region?: Region;
  @IsOptional() @IsInt() posX?: number;
  @IsOptional() @IsInt() posY?: number;
  @IsOptional() @IsInt() posZ?: number;
  @IsOptional() @IsString() building?: string;
  @IsOptional() @IsBoolean() indoors?: boolean;
}
