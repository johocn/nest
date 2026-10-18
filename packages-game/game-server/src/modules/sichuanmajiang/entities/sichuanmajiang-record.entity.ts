import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 单局每位玩家的结算记录（分数变动 + 番型明细） */
@Entity('sichuanmajiang_records')
export class SichuanMahjongRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'table_id', type: 'varchar', length: 64 })
  tableId: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'seat', type: 'int' })
  seat: number;

  @Column({ name: 'score_delta', type: 'bigint', default: '0' })
  scoreDelta: string;

  @Column({ name: 'fan_detail', type: 'jsonb', nullable: true })
  fanDetail: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
