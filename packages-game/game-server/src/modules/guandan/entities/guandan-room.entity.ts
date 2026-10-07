import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { GuandanMode, GuandanTableStatus } from '@constants/enums';

/** 掼蛋牌桌持久化（4 人 2v2，房间号以 guandan 开头） */
@Entity('guandan_rooms')
export class GuandanRoom {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index({ unique: true })
  @Column({ name: 'table_id', type: 'varchar', length: 64 })
  tableId: string;

  @Column({ name: 'mode', type: 'enum', enum: GuandanMode, default: GuandanMode.AI })
  mode: GuandanMode;

  @Column({ name: 'host_player_id', type: 'varchar', length: 64 })
  hostPlayerId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: GuandanTableStatus,
    default: GuandanTableStatus.WAITING,
  })
  status: GuandanTableStatus;

  /** 当前级数下标（0=2 ... 12=A） */
  @Column({ name: 'level_index', type: 'integer', default: 0 })
  levelIndex: number;

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
