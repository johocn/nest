import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { DEFAULT_APP_CODE } from '@shared/content-scope';

/** 玩家答题流水（无软删，仅 created_at） */
@Entity('quiz_answers')
@Index('idx_quiz_answers_player_question', ['playerId', 'questionId'])
export class QuizAnswer {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'question_id', type: 'bigint' })
  questionId: string;

  @Column({ name: 'is_correct', type: 'boolean' })
  isCorrect: boolean;

  @Column({ name: 'app_code', type: 'varchar', length: 32, default: DEFAULT_APP_CODE })
  appCode: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
