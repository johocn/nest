import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DoudizhuMode, DoudizhuTableStatus } from '@constants/enums';

/** 斗地主牌桌持久化（3 人，地主/农民阵营，房间号以 doudizhu 开头） */
@Entity('doudizhu_rooms')
export class DoudizhuRoom {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index({ unique: true })
  @Column({ name: 'table_id', type: 'varchar', length: 64 })
  tableId: string;

  @Column({
    name: 'mode',
    type: 'enum',
    enum: DoudizhuMode,
    default: DoudizhuMode.AI,
  })
  mode: DoudizhuMode;

  @Column({ name: 'host_player_id', type: 'varchar', length: 64 })
  hostPlayerId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: DoudizhuTableStatus,
    default: DoudizhuTableStatus.WAITING,
  })
  status: DoudizhuTableStatus;

  /** 地主座位（定地主后写入） */
  @Column({ name: 'landlord_seat', type: 'integer', nullable: true })
  landlordSeat: number | null;

  @Column({ name: 'base_score', type: 'integer', default: 1 })
  baseScore: number;

  @Column({ name: 'multiplier', type: 'integer', default: 1 })
  multiplier: number;

  /** 胜者座位（over 后写入） */
  @Column({ name: 'winner_seat', type: 'integer', nullable: true })
  winnerSeat: number | null;

  @Column({ name: 'landlord_win', type: 'boolean', nullable: true })
  landlordWin: boolean | null;

  @Column({ name: 'scores_json', type: 'jsonb', nullable: true })
  scoresJson: any;

  /** seat -> playerId（'bot-N' 表示 AI 座位，null 表示空位） */
  @Column({ name: 'players_json', type: 'jsonb' })
  playersJson: Record<number, string | null>;

  @Column({ name: 'settlement_json', type: 'jsonb', nullable: true })
  settlementJson: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamp', nullable: true })
  finishedAt: Date | null;
}
