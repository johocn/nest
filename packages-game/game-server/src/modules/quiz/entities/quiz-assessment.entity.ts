import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { QuizAssessmentStatus } from '@constants/enums';
import { COMMON_SCOPE } from '@shared/content-scope';

@Entity('quiz_assessments')
@Index('uq_quiz_assessment_code', ['appScope', 'code'], { unique: true })
export class QuizAssessment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: QuizAssessmentStatus, default: QuizAssessmentStatus.DRAFT })
  status: QuizAssessmentStatus;

  /** { mode: 'total'|'dimension', results: [...], dims: [...] } —— 形状见 quiz-flow 校验器 */
  @Column({ name: 'scoring_rule', type: 'jsonb', default: '{}' })
  scoringRule: Record<string, any>;

  @Column({ name: 'start_question_id', type: 'bigint', nullable: true })
  startQuestionId: string | null;

  @Column({ name: 'app_scope', type: 'varchar', length: 32, default: COMMON_SCOPE })
  appScope: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
