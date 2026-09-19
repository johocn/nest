import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { GuildActivityType, GuildActivityStatus } from '@constants/enums';

@Entity('guild_activities')
@Index('idx_activity_guild', ['guildId'])
export class GuildActivity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'guild_id', type: 'bigint' })
  guildId: string;

  @Column({ name: 'activity_type', type: 'enum', enum: GuildActivityType })
  activityType: GuildActivityType;

  @Column({ name: 'schedule_at', type: 'timestamp' })
  scheduleAt: Date;

  @Column({ type: 'enum', enum: GuildActivityStatus, default: GuildActivityStatus.SCHEDULED })
  status: GuildActivityStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
