import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { GameSessionStatus } from '@constants/enums';

@Entity('game_sessions')
export class GameSession {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'game_id', type: 'bigint' })
  gameId: string;

  @Column({ name: 'host_player_id', type: 'bigint' })
  hostPlayerId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: GameSessionStatus,
    default: GameSessionStatus.OPEN,
  })
  status: GameSessionStatus;

  @Column({ name: 'bet_pool', type: 'bigint', default: '0' })
  betPool: string;

  @Column({ name: 'winner_player_id', type: 'bigint', nullable: true })
  winnerPlayerId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
