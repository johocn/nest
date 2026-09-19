import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { KinshipType } from '@constants/enums';

export class KinshipFormDto {
  @ApiProperty({ enum: KinshipType })
  @IsEnum(KinshipType)
  type: KinshipType;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  memberIds: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  name?: string;
}
