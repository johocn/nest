import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ItemTemplate } from './item-template.entity';
import { BindStatus } from '@constants/enums';

@Entity('inventory_items')
@Index('idx_inv_player_template', ['playerId', 'itemTemplateId'])
export class InventoryItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'item_template_id', type: 'bigint' })
  itemTemplateId: string;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ name: 'slot_index', type: 'int', default: 0 })
  slotIndex: number;

  @Column({
    name: 'bind_status',
    type: 'enum',
    enum: BindStatus,
    default: BindStatus.UNBOUND,
  })
  bindStatus: BindStatus;

  @Column({ name: 'expire_at', type: 'timestamp', nullable: true })
  expireAt: Date | null;

  @Column({ name: 'extra_attrs', type: 'jsonb', nullable: true })
  extraAttrs: Record<string, any> | null;

  @ManyToOne(() => ItemTemplate)
  @JoinColumn({ name: 'item_template_id' })
  itemTemplate: ItemTemplate;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
