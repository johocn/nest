import { IsString, IsOptional, IsEnum, IsDate, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { RiskCaseStatus, PenaltyLevel } from '@constants/enums';

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

export class RiskRecoverProposalDto {
  @IsString()
  caseId!: string;
}

export class RiskRecoverDto {
  @IsString()
  @IsOptional()
  note?: string;
}

export class RiskRollbackDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

export class RiskLockDto {
  @IsEnum(PenaltyLevel)
  level: PenaltyLevel; // 复用既有惩罚等级（如 trade_limit 交易封锁 / ban 封禁）

  @IsString()
  @IsOptional()
  reason?: string;
}

/** 阈值只读回放：since/until 必填；configOverrides 仅允许 risk.* 检测阈值键（非法由服务层抛 92901） */
export class RiskReplayDto {
  @IsDate()
  @Type(() => Date)
  since!: Date;

  @IsDate()
  @Type(() => Date)
  until!: Date;

  @IsOptional()
  @IsObject()
  configOverrides?: Record<string, number>;
}