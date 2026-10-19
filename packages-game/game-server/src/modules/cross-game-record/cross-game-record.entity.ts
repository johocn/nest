import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 跨游戏关卡评分记录（与 scoring 模块解耦的独立表）。
 * 一条记录 = 某玩家在某「目标游戏」的某关卡的最佳成绩。
 * 唯一键 (player_id, target_game_id, level_id)：同一关只保留最佳 score，避免重复刷分写脏。
 */
@Entity('cross_game_records')
@Index('uq_cross_game', ['playerId', 'targetGameId', 'levelId'], {
  unique: true,
})
export class CrossGameRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** 玩家 id：一律取自 JWT，绝不信任请求体（防伪造/写错人） */
  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  /** 目标游戏 id：仅允许白名单值（见 config/targets.ts），确保数据准确关联到目标游戏 */
  @Column({ name: 'target_game_id', type: 'varchar', length: 64 })
  targetGameId: string;

  @Column({ name: 'level_id', type: 'varchar', length: 32 })
  levelId: string;

  @Column({ name: 'mode', type: 'varchar', length: 32 })
  mode: string;

  /** 综合评分 0-100（仅保留最佳） */
  @Column({ name: 'score', type: 'int' })
  score: number;

  /** 分维度标准化得分（准确率/速度/稳定性等） */
  @Column({ name: 'axes', type: 'jsonb', default: '{}' })
  axes: Record<string, number>;

  /** 原始表现指标（透传，便于追溯与复核） */
  @Column({ name: 'raw_metrics', type: 'jsonb', default: '{}' })
  rawMetrics: Record<string, number>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
