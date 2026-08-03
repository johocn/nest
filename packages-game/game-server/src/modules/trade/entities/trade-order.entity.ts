import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { TradeStatus } from '@constants/enums';

@Entity('trade_orders')
@Index('idx_trade_seller_status', ['sellerId', 'status'])
@Index('idx_trade_buyer_status', ['buyerId', 'status'])
export class TradeOrder {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'seller_id', type: 'varchar', length: 64 })
  sellerId: string;

  @Column({ name: 'buyer_id', type: 'varchar', length: 64, nullable: true })
  buyerId: string | null;

  @Column({ name: 'item_template_id', type: 'varchar', length: 64 })
  itemTemplateId: string;

  @Column({ name: 'item_name', type: 'varchar', length: 128 })
  itemName: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'price_per_unit', type: 'bigint' })
  pricePerUnit: string;

  @Column({
    name: 'currency_type',
    type: 'varchar',
    length: 32,
    default: 'gold',
  })
  currencyType: string;

  @Column({ type: 'enum', enum: TradeStatus, default: TradeStatus.PENDING })
  status: TradeStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
