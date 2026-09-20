import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';
import { RiskBizType } from '@constants/enums';

@Entity('risk_wash_flows')
@Unique('uk_risk_wash_ref', ['refId'])
@Index('idx_risk_wash_from_to', ['fromId', 'toId'])
export class RiskWashFlow {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'from_id', type: 'varchar', length: 64 })
  fromId: string;

  @Column({ name: 'to_id', type: 'varchar', length: 64 })
  toId: string;

  @Column({ name: 'asset_key', type: 'varchar', length: 64 })
  assetKey: string;

  @Column({ type: 'bigint' })
  value: string;

  @Column({ name: 'biz_type', type: 'varchar', length: 32, default: RiskBizType.TRADE_ORDER })
  bizType: RiskBizType;

  @Column({ name: 'ref_id', type: 'varchar', length: 128 })
  refId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}