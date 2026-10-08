import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 狼人杀玩家战绩：每位玩家一条，累计胜场/负场/场次与不同阵营胜率。
 */
@Entity('werewolf_player_stats')
@Index('idx_werewolf_stat_player', ['playerId'], { unique: true })
export class WerewolfPlayerStat {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'games', type: 'int', default: 0 })
  games: number;

  @Column({ name: 'wins', type: 'int', default: 0 })
  wins: number;

  @Column({ name: 'losses', type: 'int', default: 0 })
  losses: number;

  /** 以狼人身份获胜次数 */
  @Column({ name: 'wolf_wins', type: 'int', default: 0 })
  wolfWins: number;

  /** 以好人身份获胜次数 */
  @Column({ name: 'good_wins', type: 'int', default: 0 })
  goodWins: number;

  @Column({ name: 'mvp', type: 'int', default: 0 })
  mvp: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
