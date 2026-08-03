import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';

@Entity('character_memories')
export class CharacterMemory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ type: 'jsonb', default: [] })
  employers: any;

  @Column({ type: 'jsonb', default: [] })
  interactions: any;

  @Column({ type: 'jsonb', default: [] })
  secrets: any;

  @Column({ type: 'jsonb', default: [] })
  friends: any;

  @Column({ type: 'jsonb', default: [] })
  enemies: any;

  @Column({ type: 'jsonb', default: [] })
  rumors: any;
}
