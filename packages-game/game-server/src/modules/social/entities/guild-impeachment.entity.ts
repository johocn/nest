import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { GuildImpeachmentStatus } from '@constants/enums';

@Entity('guild_impeachments')
@Index(['guildId', 'status'])
export class GuildImpeachment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'guild_id', type: 'bigint' })
  guildId: string;

  @Column({ name: 'target_id', type: 'bigint' })
  targetId: string;

  @Column({ name: 'initiator_id', type: 'bigint' })
  initiatorId: string;

  @Column({ type: 'jsonb', default: '[]' })
  endorsements: string[];

  @Column({
    type: 'enum',
    enum: GuildImpeachmentStatus,
    default: GuildImpeachmentStatus.PENDING,
  })
  status: GuildImpeachmentStatus;

  @Column({ name: 'ended_at', type: 'timestamp', nullable: true })
  endedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
