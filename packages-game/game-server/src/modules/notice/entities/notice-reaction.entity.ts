import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { NoticeReactionType } from '@constants/enums';

@Entity('notice_reactions')
@Unique(['noticeId', 'playerId', 'reactionType'])
@Index('idx_reaction_notice', ['noticeId'])
export class NoticeReaction {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'notice_id', type: 'bigint' })
  noticeId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'reaction_type', type: 'enum', enum: NoticeReactionType })
  reactionType: NoticeReactionType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
