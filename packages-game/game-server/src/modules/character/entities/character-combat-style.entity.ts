import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';
import { CombatStyle } from '@constants/enums';

@Entity('character_combat_styles')
export class CharacterCombatStyle {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ type: 'enum', enum: CombatStyle, default: CombatStyle.BALANCED })
  style: CombatStyle;
}
