import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { QuestType } from '@constants/enums';

@Entity('quest_templates')
export class QuestTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({
    name: 'quest_type',
    type: 'enum',
    enum: QuestType,
    default: QuestType.MAIN,
  })
  questType: QuestType;

  @Column({ name: 'min_level', type: 'int', default: 1 })
  minLevel: number;

  @Column({ name: 'accept_limit', type: 'int', default: 1 })
  acceptLimit: number;

  @Column({ name: 'auto_reward', type: 'boolean', default: false })
  autoReward: boolean;

  @Column({ name: 'target_json', type: 'jsonb', default: '{}' })
  targetJson: Record<string, any>;

  @Column({ name: 'reward_json', type: 'jsonb', default: '{}' })
  rewardJson: Record<string, any>;

  @Column({ name: 'prerequisite_ids', type: 'int', array: true, default: [] })
  prerequisiteIds: number[];

  @Column({ name: 'target_type', type: 'varchar', length: 32, nullable: true })
  targetType: string | null;

  @Column({ name: 'prerequisite_social', type: 'jsonb', nullable: true })
  prerequisiteSocial: Record<string, any> | null;

  @Column({ name: 'reward_social', type: 'jsonb', nullable: true })
  rewardSocial: Record<string, any> | null;

  @Column({ type: 'boolean', default: false })
  repeatable: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
