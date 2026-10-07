import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { COMMON_SCOPE } from '@shared/content-scope';

@Entity('quiz_results')
@Index('uq_quiz_result_code', ['appScope', 'code'], { unique: true })
export class QuizResult {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  /** { currencyType: 'GOLD', amount: 10 } —— 测定结果发放 */
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
