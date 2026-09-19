import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';

@Entity('character_profiles')
export class CharacterProfile {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ type: 'jsonb', default: {} })
  avatar: any;

  @Column({ type: 'jsonb', default: {} })
  videos: any;

  @Column({ type: 'jsonb', default: {} })
  bio: any;

  @Column({ type: 'jsonb', default: {} })
  background: any;

  @Column({ name: 'alias', type: 'varchar', length: 24, nullable: true })
  alias: string | null;

  @Column({ name: 'poem', type: 'varchar', length: 64, nullable: true })
  poem: string | null;

  @Column({ name: 'social_bio', type: 'jsonb', default: [] })
  socialBio: any;
}
