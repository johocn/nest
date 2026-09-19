import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NegotiationStatus } from '@constants/enums';

@Entity('negotiations')
@Index('idx_negotiation_buyer', ['buyerId'])
export class Negotiation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'buyer_id', type: 'bigint' })
  buyerId: string;

  @Column({ name: 'seller_id', type: 'bigint' })
  sellerId: string;

  @Column({ name: 'trade_order_id', type: 'bigint' })
  tradeOrderId: string;

  @Column({ name: 'ask_price', type: 'bigint' })
  askPrice: string;

  @Column({ name: 'reply_price', type: 'bigint', nullable: true })
  replyPrice: string | null;

  @Column({ type: 'int', default: 1 })
  step: number;

  @Column({ name: 'max_steps', type: 'int', default: 3 })
  maxSteps: number;

  @Column({
    type: 'enum',
    enum: NegotiationStatus,
    default: NegotiationStatus.PENDING,
  })
  status: NegotiationStatus;

  @Column({ name: 'discount_percent', type: 'int', default: 0 })
  discountPercent: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  message: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
