import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { QuestHelpStatus } from '@constants/enums';

@Entity('quest_help_requests')
@Index('idx_quest_help_player', ['playerId'])
export class QuestHelpRequest {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'quest_template_id', type: 'bigint' })
  questTemplateId: string;

  @Column({ name: 'helper_id', type: 'bigint', nullable: true })
  helperId: string | null;

  @Column({
    type: 'enum',
    enum: QuestHelpStatus,
    default: QuestHelpStatus.OPEN,
  })
  status: QuestHelpStatus;

  @Column({ name: 'helped_at', type: 'timestamp', nullable: true })
  helpedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
