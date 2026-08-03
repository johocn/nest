import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { TransactionType, CurrencyType } from '@constants/enums';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'tx_type', type: 'enum', enum: TransactionType })
  txType: TransactionType;

  @Column({ name: 'currency_type', type: 'enum', enum: CurrencyType })
  currencyType: CurrencyType;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'varchar', length: 64 })
  source: string;

  @Column({ name: 'op_trace', type: 'varchar', length: 64 })
  opTrace: string;

  @Column({ name: 'order_no', type: 'varchar', length: 64, nullable: true })
  orderNo: string | null;

  @Column({ name: 'balance_after', type: 'bigint' })
  balanceAfter: string;

  @Column({ name: 'related_id', type: 'varchar', length: 64, nullable: true })
  relatedId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
