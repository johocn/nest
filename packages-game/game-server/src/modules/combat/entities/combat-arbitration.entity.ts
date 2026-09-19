import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ArbitrationStatus } from '@constants/enums';

@Entity('combat_arbitrations')
@Index('idx_arbitration_combat_log', ['combatLogId'])
export class CombatArbitration {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'combat_log_id', type: 'bigint' })
  combatLogId: string;

  @Column({ name: 'arbitrator_id', type: 'bigint' })
  arbitratorId: string;

  @Column({ name: 'parties_json', type: 'jsonb', default: '{}' })
  partiesJson: Record<string, any>;

  @Column({ name: 'claims_json', type: 'jsonb', default: '{}' })
  claimsJson: Record<string, any>;

  @Column({ type: 'enum', enum: ArbitrationStatus, default: ArbitrationStatus.PENDING })
  status: ArbitrationStatus;

  @Column({ name: 'success_rate', type: 'numeric', default: 0 })
  successRate: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  result: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
