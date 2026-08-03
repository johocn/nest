import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { SignInCycle } from '@constants/enums';

@Entity('sign_in_records')
@Unique(['playerId', 'activityId', 'signInDate'])
export class SignInRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'activity_id', type: 'varchar', length: 64 })
  activityId: string;

  @Column({ name: 'sign_in_date', type: 'date' })
  signInDate: string;

  @Column({ name: 'sign_in_cycle', type: 'enum', enum: SignInCycle })
  signInCycle: SignInCycle;

  @Column({ name: 'consecutive_days', type: 'int', default: 1 })
  consecutiveDays: number;

  @Column({ name: 'reward_claimed', type: 'boolean', default: false })
  rewardClaimed: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
