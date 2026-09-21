import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { NpcSpawnRuleType } from '@constants/enums';

@Entity('npc_spawn_rules')
@Index('idx_npc_spawn_rule_scene', ['sceneId', 'isActive'])
export class NpcSpawnRule {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'scene_id', type: 'bigint' })
  sceneId: string;

  @Column({ name: 'npc_template_id', type: 'bigint' })
  npcTemplateId: string;

  @Column({ name: 'rule_type', type: 'enum', enum: NpcSpawnRuleType })
  ruleType: NpcSpawnRuleType;

  @Column({ name: 'spawn_x', type: 'int', default: 0 })
  spawnX: number;

  @Column({ name: 'spawn_y', type: 'int', default: 0 })
  spawnY: number;

  @Column({ name: 'spawn_radius', type: 'int', default: 0 })
  spawnRadius: number;

  @Column({ name: 'spawn_count', type: 'int', default: 1 })
  spawnCount: number;

  @Column({ name: 'max_alive', type: 'int', default: 0 })
  maxAlive: number;

  @Column({ name: 'respawn_interval_sec', type: 'int', default: 0 })
  respawnIntervalSec: number;

  @Column({ name: 'time_window', type: 'jsonb', nullable: true })
  timeWindow: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  condition: Record<string, any> | null;

  @Column({ name: 'patrol_route_id', type: 'bigint', nullable: true })
  patrolRouteId: string | null;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
