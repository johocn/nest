import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { GuildBuildingType } from '@constants/enums';

@Entity('guild_buildings')
@Unique('uq_guild_building_type', ['guildId', 'buildingType'])
@Index('idx_building_guild', ['guildId'])
export class GuildBuilding {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'guild_id', type: 'bigint' })
  guildId: string;

  @Column({ name: 'building_type', type: 'enum', enum: GuildBuildingType })
  buildingType: GuildBuildingType;

  @Column({ type: 'int', default: 1 })
  level: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
