import { IsString, IsOptional, IsEnum } from 'class-validator';
import { RiskCaseStatus } from '@constants/enums';

export class RiskDisposeDto {
  @IsEnum(RiskCaseStatus)
  action: RiskCaseStatus; // 仅接受 frozen/ignored

  @IsOptional()
  @IsString()
  note?: string;
}

export class RiskWhitelistDto {
  @IsString()
  playerId: string;

  @IsOptional()
  @IsString()
  note?: string;
}