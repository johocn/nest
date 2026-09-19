import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { LootDistributionMode } from '@constants/enums';

@Entity('combat_loot_logs')
@Index('idx_loot_combat_log', ['combatLogId'])
export class CombatLootLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'combat_log_id', type: 'bigint' })
  combatLogId: string;

  @Column({ type: 'enum', enum: LootDistributionMode })
  mode: LootDistributionMode;

  @Column({ name: 'distributor_id', type: 'bigint' })
  distributorId: string;

  @Column({ name: 'items_json', type: 'jsonb', default: '{}' })
  itemsJson: Record<string, any>;

  @Column({ name: 'players_json', type: 'jsonb', default: '{}' })
  playersJson: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
