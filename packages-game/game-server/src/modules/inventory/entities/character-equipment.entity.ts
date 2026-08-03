import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { InventoryItem } from './inventory-item.entity';
import { EquipmentSlot } from '@constants/enums';

@Entity('character_equipment')
@Index('idx_equip_character_slot', ['characterId', 'slot'], { unique: true })
export class CharacterEquipment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @Column({ type: 'enum', enum: EquipmentSlot })
  slot: EquipmentSlot;

  @Column({ name: 'inventory_item_id', type: 'bigint' })
  inventoryItemId: string;

  @ManyToOne(() => InventoryItem)
  @JoinColumn({ name: 'inventory_item_id' })
  inventoryItem: InventoryItem;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
