import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Camp } from '../werewolf.constants';

export enum WerewolfMatchStatus {
  LOBBY = 'lobby',
  PLAYING = 'playing',
  FINISHED = 'finished',
}

/**
 * 狼人杀对局记录：每一局（房间）一条。
 * 角色配置以 jsonb 持久化，便于复盘与统计。
 */
@Entity('werewolf_matches')
@Index('idx_werewolf_match_room', ['roomId'], { unique: true })
export class WerewolfMatch {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'room_id', type: 'varchar', length: 64 })
  roomId: string;

  @Column({ name: 'host_player_id', type: 'bigint' })
  hostPlayerId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: WerewolfMatchStatus,
    default: WerewolfMatchStatus.LOBBY,
  })
  status: WerewolfMatchStatus;

  /** 本局角色表（jsonb）：seat -> role */
  @Column({ name: 'roles', type: 'jsonb', nullable: true })
  roles: Record<number, string> | null;

  @Column({
    name: 'winner_camp',
    type: 'varchar',
    length: 8,
    nullable: true,
  })
  winnerCamp: Camp | null;

  @Column({ name: 'player_count', type: 'int', default: 0 })
  playerCount: number;

  @Column({ name: 'cycles', type: 'int', default: 0 })
  cycles: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
