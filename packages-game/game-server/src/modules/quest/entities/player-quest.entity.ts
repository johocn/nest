import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { QuestStatus } from '@constants/enums';

@Entity('player_quests')
@Index('idx_player_quest_player', ['playerId'])
@Index('idx_player_quest_template', ['questTemplateId'])
export class PlayerQuest {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'quest_template_id', type: 'bigint' })
  questTemplateId: string;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'enum', enum: QuestStatus, default: QuestStatus.NOT_STARTED })
  status: QuestStatus;

  @Column({ name: 'complete_times', type: 'int', default: 0 })
  completeTimes: number;

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
