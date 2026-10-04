import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { GiftCodeGenerateType, GiftCodeClaimLimit } from '@constants/enums';

/**
 * 礼包模板 —— 运营侧定义「一个礼包是什么」。
 * 兑换码（GiftCode）生成时引用模板，领用时按 template.rewards 发奖。
 */
@Entity('gift_code_templates')
export class GiftCodeTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  description: string | null;

  /** 生成方式 */
  @Column({ name: 'generate_type', type: 'enum', enum: GiftCodeGenerateType })
  generateType: GiftCodeGenerateType;

  /** 规则生成时的前缀，如 "WELCOME2025-" */
  @Column({ type: 'varchar', length: 32, nullable: true })
  prefix: string | null;

  /**
   * 奖励配置 JSON —— 两种口径：
   *  1) items: [{ itemTemplateId, quantity }] —— 发道具
   *  2) currency: { gold: 1000, gem: 100 } —— 发货币
   *  可混用：{ items: [...], currency: {...}, exp: 5000 }
   */
  @Column({ name: 'rewards', type: 'jsonb', default: '{}' })
  rewards: {
    items?: Array<{ itemTemplateId: string; quantity: number }>;
    currency?: Record<string, number>;
    exp?: number;
    vipExp?: number;
  };

  /** 模板级有效期（秒）；兑换码自身也可能覆盖，取较短者 */
  @Column({ name: 'valid_seconds', type: 'int', default: 60 * 60 * 24 * 7 })
  validSeconds: number;

  @Column({ name: 'claim_limit', type: 'enum', enum: GiftCodeClaimLimit, default: GiftCodeClaimLimit.ONE_PER_PLAYER })
  claimLimit: GiftCodeClaimLimit;

  /** 该模板总可用兑换码数上限（0 = 不限制） */
  @Column({ name: 'total_limit', type: 'int', default: 0 })
  totalLimit: number;

  /** 已兑换次数（原子递增） */
  @Column({ name: 'claimed_count', type: 'int', default: 0 })
  claimedCount: number;

  /** 是否启用 —— 模板级开关，所有关联兑换码随模板停用时不可领 */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}

/** 单个兑换码 —— 1:N 对应模板；兑换时原子从 ACTIVE 变 USED */
@Entity('gift_codes')
@Index('idx_giftcode_code', ['code'], { unique: true })
@Index('idx_giftcode_template', ['templateId'])
export class GiftCode {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ name: 'template_id', type: 'bigint' })
  templateId: string;

  /** 该码的有效期起点（可早于模板） */
  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  /** 该码的有效期终点；null 则按模板 valid_seconds 推 */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'used' | 'disabled' | 'expired';

  @Column({ name: 'claimed_by', type: 'bigint', nullable: true })
  claimedBy: string | null;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/** 兑换记录 —— 防刷证据链 + 审计 */
@Entity('gift_code_redemptions')
@Index('idx_redemption_code', ['codeId'])
@Index('idx_redemption_player', ['playerId'])
export class GiftCodeRedemption {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'code_id', type: 'bigint' })
  codeId: string;

  @Column({ name: 'template_id', type: 'bigint' })
  templateId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'code_snapshot', type: 'varchar', length: 64 })
  codeSnapshot: string;

  @Column({ name: 'reward_snapshot', type: 'jsonb', default: '{}' })
  rewardSnapshot: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
