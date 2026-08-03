import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';
import { Region } from '@constants/enums';

@Entity('character_locations')
export class CharacterLocation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ name: 'map_id', type: 'varchar', length: 64, default: 'map_001' })
  mapId: string;

  @Column({ name: 'land_id', type: 'varchar', length: 64, nullable: true })
  landId: string | null;

  @Column({ type: 'enum', enum: Region, default: Region.CENTRAL_CITY })
  region: Region;

  @Column({ name: 'pos_x', type: 'int', default: 0 })
  posX: number;

  @Column({ name: 'pos_y', type: 'int', default: 0 })
  posY: number;

  @Column({ name: 'pos_z', type: 'int', default: 0 })
  posZ: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  building: string | null;

  @Column({ type: 'boolean', default: false })
  indoors: boolean;

  @Column({ name: 'last_move_at', type: 'timestamp', nullable: true })
  lastMoveAt: Date | null;

  @Column({ name: 'path_history', type: 'jsonb', default: [] })
  pathHistory: any;
}
