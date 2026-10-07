import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SichuanMahjongTableStatus, SichuanMahjongMode } from '@constants/enums';

/** 麻将牌桌持久化（用户共享的 4 人桌，房间号以 sichuanmajiang 开头） */
@Entity('sichuanmajiang_rooms')
export class SichuanMahjongRoom {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index({ unique: true })
  @Column({ name: 'table_id', type: 'varchar', length: 64 })
  tableId: string;

  @Column({ name: 'mode', type: 'enum', enum: SichuanMahjongMode, default: SichuanMahjongMode.AI })
  mode: SichuanMahjongMode;

  @Column({ name: 'host_player_id', type: 'varchar', length: 64 })
  hostPlayerId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: SichuanMahjongTableStatus,
    default: SichuanMahjongTableStatus.WAITING,
  })
  status: SichuanMahjongTableStatus;

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
