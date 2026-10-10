import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import type { ScoringConfig } from '../scoring.types';

/** 评分配置（每游戏一份 ScoringConfig；软删行仍占用 game_id 唯一索引，冲突检查需含软删行） */
@Entity('scoring_configs')
@Index('uq_scoring_game', ['gameId'], { unique: true })
export class ScoringConfigEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'game_id', type: 'varchar', length: 64 })
  gameId: string;

  @Column({ type: 'json' })
  config: ScoringConfig;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
