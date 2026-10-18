import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 玩家评分状态（key = player_id + game_id；state jsonb 仅存值，加载时与当前 config 合并） */
@Entity('player_scoring_states')
@Index('uq_player_scoring', ['playerId', 'gameId'], { unique: true })
export class PlayerScoringState {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'game_id', type: 'varchar', length: 64 })
  gameId: string;

  @Column({ type: 'jsonb', default: '{}' })
  state: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
