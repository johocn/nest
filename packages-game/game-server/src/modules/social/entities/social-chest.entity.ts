import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SocialChestType, SocialChestStatus } from '@constants/enums';

@Entity('social_chests')
@Index('idx_chest_player_status', ['playerId', 'status'])
@Index('idx_chest_player_week', ['playerId', 'sourceWeek'])
export class SocialChest {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'chest_type', type: 'enum', enum: SocialChestType })
  chestType: SocialChestType;

  @Column({ type: 'int' })
  tier: number;

  @Column({ type: 'int', default: 0 })
  cost: number;

  @Column({
    type: 'enum',
    enum: SocialChestStatus,
    default: SocialChestStatus.PENDING,
  })
  status: SocialChestStatus;

  @Column({ name: 'reward_json', type: 'jsonb', default: {} })
  rewardJson: Record<string, any>;

  @Column({ name: 'source_week', type: 'varchar', length: 10, nullable: true })
  sourceWeek: string | null;

  @Column({ name: 'opened_at', type: 'timestamp', nullable: true })
  openedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
