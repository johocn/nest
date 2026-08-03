import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ActivityType, ActivityStatus, SignInCycle } from '@constants/enums';

@Entity('activity_templates')
export class ActivityTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ name: 'activity_type', type: 'enum', enum: ActivityType })
  activityType: ActivityType;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'start_at', type: 'timestamp' })
  startAt: Date;

  @Column({ name: 'end_at', type: 'timestamp' })
  endAt: Date;

  @Column({ type: 'enum', enum: ActivityStatus, default: ActivityStatus.DRAFT })
  status: ActivityStatus;

  @Column({
    name: 'sign_in_cycle',
    type: 'enum',
    enum: SignInCycle,
    nullable: true,
  })
  signInCycle: SignInCycle | null;

  @Column({ name: 'reward_json', type: 'jsonb', default: '{}' })
  rewardJson: Record<string, any>;

  @Column({ name: 'condition_json', type: 'jsonb', default: '{}' })
  conditionJson: Record<string, any>;

  @Column({ name: 'max_participants', type: 'int', default: 0 })
  maxParticipants: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
