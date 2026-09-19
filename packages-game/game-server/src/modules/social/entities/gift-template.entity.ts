import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('gift_templates')
export class GiftTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  itemId: string;

  @Column({ name: 'gift_weight', type: 'int', default: 1 })
  giftWeight: number;

  @Column({ name: 'daily_cap', type: 'int', default: 5 })
  dailyCap: number;
}
