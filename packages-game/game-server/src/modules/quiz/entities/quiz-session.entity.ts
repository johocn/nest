import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { QuizSessionStatus } from '@constants/enums';
import { DEFAULT_APP_CODE } from '@shared/content-scope';

/** 玩家数据（无 app_scope，有 app_code；started_at 即创建时间） */
@Entity('quiz_sessions')
@Index('idx_quiz_sessions_player', ['playerId', 'status'])
export class QuizSession {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'assessment_id', type: 'bigint' })
  assessmentId: string;

  @Column({ type: 'enum', enum: QuizSessionStatus, default: QuizSessionStatus.IN_PROGRESS })
  status: QuizSessionStatus;

  @Column({ name: 'current_question_id', type: 'bigint', nullable: true })
  currentQuestionId: string | null;

  @Column({ name: 'total_score', type: 'int', default: 0 })
  totalScore: number;

  @Column({ name: 'dim_scores', type: 'jsonb', default: '{}' })
  dimScores: Record<string, number>;

  @Column({ type: 'jsonb', default: '[]' })
  answers: Array<Record<string, any>>;

  @Column({ name: 'app_code', type: 'varchar', length: 32, default: DEFAULT_APP_CODE })
  appCode: string;

  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
