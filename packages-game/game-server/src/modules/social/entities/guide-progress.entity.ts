import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { GuideTaskStatus } from '@constants/enums';

@Entity('guide_progresses')
@Index('idx_guide_player_task', ['playerId', 'taskId'], { unique: true })
export class GuideProgress {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'int' })
  day: number;

  @Column({ name: 'task_id', type: 'varchar', length: 24 })
  taskId: string;

  @Column({
    type: 'enum',
    enum: GuideTaskStatus,
    default: GuideTaskStatus.DONE,
  })
  status: GuideTaskStatus;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'claimed_at', type: 'timestamp', nullable: true })
  claimedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
