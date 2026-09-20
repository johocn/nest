import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { AuctionStatus } from '@constants/enums';

@Entity('auction_items')
@Index('idx_auction_status_expire', ['status', 'expireAt'])
@Index('idx_auction_seller', ['sellerId'])
export class AuctionItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'seller_id', type: 'varchar', length: 64 })
  sellerId: string;

  @Column({ name: 'item_template_id', type: 'varchar', length: 64 })
  itemTemplateId: string;

  @Column({ name: 'item_name', type: 'varchar', length: 128 })
  itemName: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'start_price', type: 'bigint' })
  startPrice: string;

  @Column({ name: 'current_price', type: 'bigint' })
  currentPrice: string;

  @Column({
    name: 'current_bidder_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  currentBidderId: string | null;

  @Column({ name: 'expire_at', type: 'timestamp' })
  expireAt: Date;

  // 专属拍卖室标记：仅 VIP 特权（exclusiveAuctionRoom）达标的卖家可上架
  @Column({ name: 'is_exclusive', type: 'boolean', default: false })
  isExclusive: boolean;

  @Column({ type: 'enum', enum: AuctionStatus, default: AuctionStatus.LISTED })
  status: AuctionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
