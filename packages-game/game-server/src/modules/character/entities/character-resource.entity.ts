import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';

@Entity('character_resources')
export class CharacterResource {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ type: 'int', default: 0 })
  food: number;

  @Column({ type: 'int', default: 0 })
  wood: number;

  @Column({ type: 'int', default: 0 })
  iron: number;

  @Column({ type: 'int', default: 0 })
  herb: number;

  @Column({ type: 'int', default: 0 })
  gold: number;
}
