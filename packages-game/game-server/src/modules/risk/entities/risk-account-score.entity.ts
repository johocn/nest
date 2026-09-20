import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';
import { RiskLevel } from '@constants/enums';

@Entity('risk_account_scores')
export class RiskAccountScore {
  @PrimaryColumn({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'risk_score', type: 'int', default: 0 })
  riskScore: number;

  @Column({ type: 'enum', enum: RiskLevel, default: RiskLevel.NORMAL })
  level: RiskLevel;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}