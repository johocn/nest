import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class UpdateCardDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 24)
  alias?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  poem?: string;
}

export class EquipTitleDto {
  @ApiProperty()
  @IsString()
  titleId: string;

  @ApiProperty()
  @IsBoolean()
  equip: boolean;
}
