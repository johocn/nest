import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { GuildFundType } from '@constants/enums';

@Entity('guild_fund_logs')
@Index('idx_fundlog_guild', ['guildId'])
export class GuildFundLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'guild_id', type: 'bigint' })
  guildId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'bigint', default: '0' })
  amount: string;

  @Column({ type: 'enum', enum: GuildFundType })
  type: GuildFundType;

  @Column({ type: 'varchar', length: 128 })
  reason: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
