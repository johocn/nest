import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ItemChangeType } from '@constants/enums';

@Entity('player_item_change_logs')
@Index('idx_item_log_player', ['playerId'])
@Index('idx_item_log_template', ['itemTemplateId'])
export class PlayerItemChangeLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'item_template_id', type: 'bigint' })
  itemTemplateId: string;

  @Column({ name: 'change_type', type: 'enum', enum: ItemChangeType })
  changeType: ItemChangeType;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'op_trace', type: 'varchar', length: 128 })
  opTrace: string;

  @Column({ name: 'balance_after', type: 'int' })
  balanceAfter: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
