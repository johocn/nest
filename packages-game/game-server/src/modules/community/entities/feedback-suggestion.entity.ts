import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { FeedbackCategory, FeedbackStatus } from '@constants/enums';

@Entity('feedback_suggestions')
@Index('idx_feedback_player', ['playerId'])
@Index('idx_feedback_status', ['status'])
export class FeedbackSuggestion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'enum', enum: FeedbackCategory })
  category: FeedbackCategory;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'enum', enum: FeedbackStatus, default: FeedbackStatus.PENDING })
  status: FeedbackStatus;

  @Column({ type: 'text', nullable: true })
  reply: string | null;

  @Column({ name: 'admin_id', type: 'bigint', nullable: true })
  adminId: string | null;

  @Column({ name: 'handled_at', type: 'timestamp', nullable: true })
  handledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
