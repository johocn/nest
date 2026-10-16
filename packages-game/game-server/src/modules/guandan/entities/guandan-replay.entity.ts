import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 掼蛋回合回放（开局手牌快照 + 动作日志），用于复盘 */
@Entity('guandan_replays')
export class GuandanReplay {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'table_id', type: 'varchar', length: 64 })
  tableId: string;

  /** 该回合所打的级数（rank 值） */
  @Column({ name: 'level', type: 'integer', default: 0 })
  level: number;

  /** 座位信息：[{ seat, nickname, isBot }] */
  @Column({ name: 'players_json', type: 'jsonb' })
  playersJson: any;

  /** 开局手牌快照（贡还之后）：index=座位 */
  @Column({ name: 'initial_hands_json', type: 'jsonb' })
  initialHandsJson: any;

  /** 动作日志：GameLogEntry[] */
  @Column({ name: 'actions_json', type: 'jsonb' })
  actionsJson: any;

  /** 回合结算（RoundSettlement） */
  @Column({ name: 'settlement_json', type: 'jsonb', nullable: true })
  settlementJson: any;

  /** 贡还信息（KowtowInfo） */
  @Column({ name: 'kowtow_json', type: 'jsonb', nullable: true })
  kowtowJson: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
