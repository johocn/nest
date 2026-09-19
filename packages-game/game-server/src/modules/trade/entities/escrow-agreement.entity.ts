import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { EscrowStatus } from '@constants/enums';

@Entity('escrow_agreements')
@Index('idx_escrow_buyer', ['buyerId'])
export class EscrowAgreement {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'buyer_id', type: 'bigint' })
  buyerId: string;

  @Column({ name: 'seller_id', type: 'bigint' })
  sellerId: string;

  @Column({ name: 'guarantor_id', type: 'bigint' })
  guarantorId: string;

  @Column({ name: 'trade_order_id', type: 'bigint' })
  tradeOrderId: string;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ name: 'fee_percent', type: 'int', default: 2 })
  feePercent: number;

  @Column({
    type: 'enum',
    enum: EscrowStatus,
    default: EscrowStatus.PENDING,
  })
  status: EscrowStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'released_at', type: 'timestamp', nullable: true })
  releasedAt: Date | null;
}
