import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 归属随卷（无 app_scope 列），随 assessment 全量替换 */
@Entity('quiz_assessment_items')
@Index('idx_quiz_items_assessment', ['assessmentId', 'sortOrder'])
export class QuizAssessmentItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'assessment_id', type: 'bigint' })
  assessmentId: string;

  @Column({ name: 'question_id', type: 'bigint' })
  questionId: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'next_question_id', type: 'bigint', nullable: true })
  nextQuestionId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  dimension: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
