import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { CreditStatus } from '@constants/enums';

@Entity('credit_debts')
@Index('idx_credit_borrower', ['borrowerId'])
export class CreditDebt {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'borrower_id', type: 'bigint' })
  borrowerId: string;

  @Column({ name: 'lender_id', type: 'bigint' })
  lenderId: string;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ name: 'due_at', type: 'timestamp' })
  dueAt: Date;

  @Column({ name: 'collateral_amount', type: 'bigint' })
  collateralAmount: string;

  @Column({
    type: 'enum',
    enum: CreditStatus,
    default: CreditStatus.ACTIVE,
  })
  status: CreditStatus;

  @Column({ name: 'settled_at', type: 'timestamp', nullable: true })
  settledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
