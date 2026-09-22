import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { BuildMode } from '@constants/enums';

/**
 * 场景建造规则（S6）
 * 每个场景至多一行；无行 = 该场景不允许建造（等价 forbidden）。
 */
@Entity('scene_build_rules')
@Index('uq_scene_build_rule_scene', ['sceneId'], { unique: true })
export class SceneBuildRule {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'scene_id', type: 'bigint' })
  sceneId: string;

  @Column({ name: 'mode', type: 'enum', enum: BuildMode, default: BuildMode.FORBIDDEN })
  mode: BuildMode;

  @Column({ name: 'land_grid_size', type: 'int', default: 64 })
  landGridSize: number;

  @Column({ name: 'max_buildings_per_player', type: 'int', default: 5 })
  maxBuildingsPerPlayer: number;

  @Column({ name: 'allow_demolish', type: 'boolean', default: true })
  allowDemolish: boolean;

  @Column({ name: 'coop_min_contributors', type: 'int', default: 2 })
  coopMinContributors: number;

  @Column({ name: 'coop_expire_hours', type: 'int', default: 24 })
  coopExpireHours: number;

  @Column({ name: 'reserved_zones', type: 'jsonb', default: () => "'[]'" })
  reservedZones: Record<string, any>[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}