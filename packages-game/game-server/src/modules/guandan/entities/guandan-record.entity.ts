import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 掼蛋对局战绩（每回合结算为每个玩家一条记录，含升级数） */
@Entity('guandan_records')
export class GuandanRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'table_id', type: 'varchar', length: 64 })
  tableId: string;

  @Index()
  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'seat', type: 'integer' })
  seat: number;

  /** 所属队伍：0=座位0&2，1=座位1&3 */
  @Column({ name: 'team', type: 'integer', default: 0 })
  team: number;

  /** 本回合升级数（赢方为正，输方为 0） */
  @Column({ name: 'level_up', type: 'integer', default: 0 })
  levelUp: number;

  @Column({ name: 'is_winner', type: 'boolean', default: false })
  isWinner: boolean;

  @Column({ name: 'detail_json', type: 'jsonb', nullable: true })
  detailJson: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
