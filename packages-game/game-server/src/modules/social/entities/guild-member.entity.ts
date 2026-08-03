import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { GuildRole } from '@constants/enums';

@Entity('guild_members')
@Index('idx_guild_member_guild', ['guildId'])
@Index('idx_guild_member_player', ['playerId'])
export class GuildMember {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'guild_id', type: 'bigint' })
  guildId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'enum', enum: GuildRole, default: GuildRole.MEMBER })
  role: GuildRole;

  @Column({ type: 'int', default: 0 })
  contribution: number;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;
}
