import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { ReconcileType } from '@constants/enums';

/**
 * 交易结算对账审计结果。按 stat_date + reconcile_type 幂等（当日已存在则覆盖）。
 * detail_json 为异常清单，每条含 { bizId, type: MISSING_FLOW|AMOUNT_MISMATCH|DUPLICATE_REF, hint }。
 * 审计仅标记，不自动动账；金额比较用 numeric/BigInt。
 */
@Entity('reconcile_results')
@Unique('uk_reconcile_date_type', ['statDate', 'reconcileType'])
export class ReconcileResult {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'stat_date', type: 'varchar', length: 10 })
  statDate: string;

  @Column({ name: 'reconcile_type', type: 'enum', enum: ReconcileType })
  reconcileType: ReconcileType;

  @Column({ type: 'bigint', default: 0 })
  checked: string;

  @Column({ type: 'bigint', default: 0 })
  mismatch: string;

  @Column({ name: 'detail_json', type: 'jsonb', default: '[]' })
  detailJson: Array<Record<string, string>>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}