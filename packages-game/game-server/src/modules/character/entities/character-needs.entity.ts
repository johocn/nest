import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';

@Entity('character_needs')
export class CharacterNeeds {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ type: 'int', default: 50 })
  survival: number;

  @Column({ type: 'int', default: 50 })
  safety: number;

  @Column({ type: 'int', default: 50 })
  belonging: number;

  @Column({ type: 'int', default: 50 })
  esteem: number;

  @Column({ type: 'int', default: 50 })
  actualization: number;
}
