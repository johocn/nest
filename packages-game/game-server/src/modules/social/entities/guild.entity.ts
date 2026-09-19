import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('guilds')
export class Guild {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  name: string;

  @Column({ name: 'leader_id', type: 'bigint' })
  leaderId: string;

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ name: 'member_count', type: 'int', default: 1 })
  memberCount: number;

  @Column({ name: 'guild_icon', type: 'varchar', length: 128, nullable: true })
  guildIcon: string | null;

  @Column({ name: 'guild_buff', type: 'jsonb', default: '{}' })
  guildBuff: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  announcement: string | null;

  @Column({ name: 'action_log', type: 'jsonb', default: '[]' })
  actionLog: Array<{
    type: string;
    playerId: string;
    detail: string;
    at: string;
  }>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'disbanded_at' })
  disbandedAt: Date | null;
}
