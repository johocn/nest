import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { RiskRecoverStatus } from '@constants/enums';

@Entity('risk_recover_records')
export class RiskRecoverRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'case_id', type: 'varchar', length: 64 })
  caseId: string;

  @Column({ name: 'from_id', type: 'varchar', length: 64 })
  fromId: string;

  @Column({ name: 'to_id', type: 'varchar', length: 64 })
  toId: string;

  @Column({ name: 'suggested_amount', type: 'bigint' })
  suggestedAmount: string;

  @Column({ name: 'applied_amount', type: 'bigint', default: '0' })
  appliedAmount: string;

  @Column({ name: 'economy_ref_id', type: 'varchar', length: 64, nullable: true })
  economyRefId: string | null;

  @Column({ name: 'asset_key', type: 'varchar', length: 64 })
  assetKey: string;

  @Column({ type: 'enum', enum: RiskRecoverStatus, default: RiskRecoverStatus.APPLIED })
  status: RiskRecoverStatus;

  @Column({ name: 'balance_snapshot_json', type: 'jsonb', default: '{}' })
  balanceSnapshotJson: Record<string, string>;

  @Column({ name: 'handled_by', type: 'varchar', length: 64, nullable: true })
  handledBy: string | null;

  @Column({ name: 'rollback_reason', type: 'text', nullable: true })
  rollbackReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}