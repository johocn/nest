import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Identity } from '@constants/enums';

/** 三国杀对局战绩（每人一条，含身份与胜负，用于历史/结算） */
@Entity('sanguosha_records')
export class SanguoshaRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'table_id', type: 'varchar', length: 64 })
  tableId: string;

  @Index()
  @Column({
    name: 'tenant_id',
    type: 'varchar',
    length: 64,
    default: 'default',
  })
  tenantId: string;

  @Index()
  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'seat', type: 'integer' })
  seat: number;

  @Column({ name: 'identity', type: 'varchar', length: 16, nullable: true })
  identity: Identity | null;

  @Column({ name: 'is_winner', type: 'boolean', default: false })
  isWinner: boolean;

  @Column({ name: 'detail_json', type: 'jsonb', nullable: true })
  detailJson: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
