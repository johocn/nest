import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { CombatType, CombatResult } from '@constants/enums';

@Entity('combat_logs')
@Index('idx_combat_attacker', ['attackerId'])
@Index('idx_combat_defender', ['defenderId'])
export class CombatLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'attacker_id', type: 'bigint' })
  attackerId: string;

  @Column({ name: 'defender_id', type: 'bigint' })
  defenderId: string;

  @Column({ name: 'scene_id', type: 'bigint', nullable: true })
  sceneId: string | null;

  @Column({ name: 'team_id', type: 'varchar', nullable: true })
  teamId: string | null;

  @Column({ name: 'combat_type', type: 'enum', enum: CombatType })
  combatType: CombatType;

  @Column({ type: 'enum', enum: CombatResult })
  result: CombatResult;

  @Column({ name: 'damage_json', type: 'jsonb', default: '{}' })
  damageJson: Record<string, any>;

  @Column({ name: 'reward_json', type: 'jsonb', default: '{}' })
  rewardJson: Record<string, any>;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
