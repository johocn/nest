import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { GuildDiplomacyRelation } from '@constants/enums';

@Entity('guild_diplomacies')
@Unique('uq_diplomacy_pair', ['guildId', 'targetGuildId'])
@Index('idx_diplomacy_guild', ['guildId'])
export class GuildDiplomacy {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'guild_id', type: 'bigint' })
  guildId: string;

  @Column({ name: 'target_guild_id', type: 'bigint' })
  targetGuildId: string;

  @Column({ type: 'enum', enum: GuildDiplomacyRelation, default: GuildDiplomacyRelation.NEUTRAL })
  relation: GuildDiplomacyRelation;

  @Column({ type: 'int', default: 0 })
  reputation: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
