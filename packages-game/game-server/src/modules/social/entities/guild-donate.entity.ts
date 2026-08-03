import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DonateType } from '@constants/enums';

@Entity('guild_donates')
@Index('idx_donate_guild', ['guildId'])
@Index('idx_donate_player', ['playerId'])
export class GuildDonate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'guild_id', type: 'bigint' })
  guildId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'donate_type', type: 'enum', enum: DonateType })
  donateType: DonateType;

  @Column({ type: 'bigint', default: '0' })
  amount: string;

  @Column({ name: 'contribution_gained', type: 'int', default: 0 })
  contributionGained: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
