import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ItemType, ItemRarity, BindType } from '@constants/enums';

@Entity('item_templates')
export class ItemTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({
    name: 'item_type',
    type: 'enum',
    enum: ItemType,
    default: ItemType.MATERIAL,
  })
  itemType: ItemType;

  @Column({ type: 'enum', enum: ItemRarity, default: ItemRarity.COMMON })
  rarity: ItemRarity;

  @Column({ name: 'max_stack', type: 'int', default: 99 })
  maxStack: number;

  @Column({ name: 'sell_price', type: 'bigint', default: '0' })
  sellPrice: string;

  @Column({ name: 'can_trade', type: 'boolean', default: true })
  canTrade: boolean;

  @Column({ name: 'can_drop', type: 'boolean', default: true })
  canDrop: boolean;

  @Column({
    name: 'bind_type',
    type: 'enum',
    enum: BindType,
    default: BindType.NONE,
  })
  bindType: BindType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'config_json', type: 'jsonb', default: '{}' })
  configJson: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
