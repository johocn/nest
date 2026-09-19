import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { BarterStatus } from '@constants/enums';

@Entity('barter_deals')
export class BarterDeal {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'party_a_id', type: 'bigint' })
  partyAId: string;

  @Column({ name: 'party_b_id', type: 'bigint', nullable: true })
  partyBId: string | null;

  @Column({ name: 'items_a_json', type: 'jsonb', default: '{}' })
  itemsAJson: Record<string, any>;

  @Column({ name: 'items_b_json', type: 'jsonb', default: '{}' })
  itemsBJson: Record<string, any>;

  @Column({ name: 'gold_amount', type: 'bigint', default: '0' })
  goldAmount: string;

  @Column({ name: 'a_confirm', type: 'bool', default: false })
  aConfirm: boolean;

  @Column({ name: 'b_confirm', type: 'bool', default: false })
  bConfirm: boolean;

  @Column({
    type: 'enum',
    enum: BarterStatus,
    default: BarterStatus.PENDING,
  })
  status: BarterStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
