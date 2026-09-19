import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RealNameDto {
  @ApiProperty()
  @IsString()
  @Length(2, 32)
  realName: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{17}[\dXx]$/, { message: '身份证号格式不正确' })
  idNo: string;
}

export class VerifyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  deviceInfo?: string;
}

export class AntiAddictionDto {
  @ApiProperty()
  @IsBoolean()
  on: boolean;
}
