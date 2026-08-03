import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';

@Entity('character_specialties')
export class CharacterSpecialty {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ name: 'primary_specialty', type: 'varchar', length: 50 })
  primarySpecialty: string;

  @Column({ name: 'secondary_specialties', type: 'jsonb', default: [] })
  secondarySpecialties: any;

  @Column({ type: 'jsonb', default: { primary: 1.0, secondary: 1.0 } })
  efficiency: any;
}
