import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';

@Entity('character_attributes')
export class CharacterAttribute {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @Column({ type: 'int', default: 10 })
  strength: number;

  @Column({ type: 'int', default: 10 })
  speed: number;

  @Column({ type: 'int', default: 10 })
  defense: number;

  @Column({ type: 'int', default: 10 })
  intelligence: number;

  @Column({ type: 'int', default: 10 })
  comprehension: number;

  @Column({ type: 'int', default: 50 })
  loyalty: number;

  @Column({ name: 'loyalty_base', type: 'int', default: 50 })
  loyaltyBase: number;

  @Column({ name: 'combat_power', type: 'bigint', default: '0' })
  combatPower: string;
}
