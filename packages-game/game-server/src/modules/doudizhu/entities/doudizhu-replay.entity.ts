import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 斗地主整局回放（开局手牌快照 + 动作日志），用于复盘 */
@Entity('doudizhu_replays')
export class DoudizhuReplay {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'table_id', type: 'varchar', length: 64 })
  tableId: string;

  /** 座位信息：[{ seat, playerId, isBot }] */
  @Column({ name: 'players_json', type: 'jsonb' })
  playersJson: any;

  /** 开局手牌快照（定地主后，含底牌）：index=座位 */
  @Column({ name: 'initial_hands_json', type: 'jsonb' })
  initialHandsJson: any;

  /** 动作日志：DoudizhuActionLogEntry[] */
  @Column({ name: 'actions_json', type: 'jsonb' })
  actionsJson: any;

  /** 当局结算（DoudizhuClientState 摘要） */
  @Column({ name: 'settlement_json', type: 'jsonb', nullable: true })
  settlementJson: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
