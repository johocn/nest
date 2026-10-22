import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 斗地主对局战绩（每个真人玩家一条记录，含身份与得分） */
@Entity('doudizhu_records')
export class DoudizhuRecord {
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

  /** 是否地主 */
  @Column({ name: 'is_landlord', type: 'boolean', default: false })
  isLandlord: boolean;

  /** 是否本局胜方 */
  @Column({ name: 'is_winner', type: 'boolean', default: false })
  isWinner: boolean;

  /** 本局得分（正=赢，负=输，已含倍数与春天） */
  @Column({ name: 'delta_score', type: 'integer', default: 0 })
  deltaScore: number;

  @Column({ name: 'detail_json', type: 'jsonb', nullable: true })
  detailJson: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
