import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ConfigType } from '@constants/enums';

export class SetConfigDto {
  @IsString()
  key: string;

  @IsString()
  value: string;

  @IsEnum(ConfigType)
  configType: ConfigType;

  @IsOptional()
  @IsString()
  description?: string;
}
