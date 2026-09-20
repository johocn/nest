import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  oldPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  newPassword: string;
}