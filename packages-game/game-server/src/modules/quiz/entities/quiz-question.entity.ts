import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { QuizQuestionKind } from '@constants/enums';
import { COMMON_SCOPE } from '@shared/content-scope';

export interface QuizOption {
  text: string;
  answer?: boolean; // knowledge 用：正确选项标记
  score?: number; // assessment 用：选项分值
  goto?: string; // assessment 用：跳转目标题目 code（覆盖卷内顺序）
  explain?: string; // knowledge 用：解析（不下发，答后返回）
}

@Entity('quiz_questions')
@Index('uq_quiz_question_code', ['appScope', 'code'], { unique: true })
export class QuizQuestion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'enum', enum: QuizQuestionKind })
  kind: QuizQuestionKind;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', default: '[]' })
  options: QuizOption[];

  @Column({ name: 'multi_select', type: 'boolean', default: false })
  multiSelect: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  category: string | null;

  @Column({ type: 'int', default: 1 })
  difficulty: number;

  @Column({ type: 'jsonb', default: '[]' })
  tags: string[];

  /** { currencyType: 'GOLD', amount: 10 } —— 知识题答对（首次）发放 */
  @Column({ name: 'reward_json', type: 'jsonb', default: '{}' })
  rewardJson: Record<string, any>;

  @Column({ name: 'app_scope', type: 'varchar', length: 32, default: COMMON_SCOPE })
  appScope: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
