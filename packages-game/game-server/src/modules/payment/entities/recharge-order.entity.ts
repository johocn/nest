import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { RechargeStatus } from '@constants/enums';

@Entity('recharge_orders')
@Index('idx_recharge_player_created', ['playerId', 'createdAt'])
@Index('idx_recharge_status', ['status'])
export class RechargeOrder {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'order_no', type: 'varchar', length: 64, unique: true })
  orderNo: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'product_id', type: 'varchar', length: 64 })
  productId: string;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'varchar', length: 16, default: 'CNY' })
  currency: string;

  @Column({
    type: 'enum',
    enum: RechargeStatus,
    default: RechargeStatus.PENDING,
  })
  status: RechargeStatus;

  @Column({ type: 'varchar', length: 32, default: 'mock' })
  platform: string;

  @Column({ name: 'callback_at', type: 'timestamp', nullable: true })
  callbackAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
