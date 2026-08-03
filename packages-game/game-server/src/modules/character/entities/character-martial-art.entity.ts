import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Character } from './character.entity';
import { MartialArtType } from '@constants/enums';

@Entity('character_martial_arts')
@Index(['characterId', 'artType'], { unique: true })
export class CharacterMartialArt {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @ManyToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ name: 'art_type', type: 'enum', enum: MartialArtType })
  artType: MartialArtType;

  @Column({ type: 'int', default: 0 })
  level: number;

  @Column({ type: 'jsonb', default: [] })
  skills: any;
}
