import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ActivityType } from '@constants/enums';

@Entity('player_activities')
export class PlayerActivity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'activity_id', type: 'varchar', length: 64 })
  activityId: string;

  @Column({ name: 'activity_type', type: 'enum', enum: ActivityType })
  activityType: ActivityType;

  @Column({ name: 'progress', type: 'int', default: 0 })
  progress: number;

  @Column({ name: 'is_reward_claimed', type: 'boolean', default: false })
  isRewardClaimed: boolean;

  @Column({ name: 'joined_at', type: 'timestamp' })
  joinedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
