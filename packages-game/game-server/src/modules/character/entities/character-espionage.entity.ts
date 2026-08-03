import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';

@Entity('character_espionages')
export class CharacterEspionage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ name: 'can_spy', type: 'boolean', default: false })
  canSpy: boolean;

  @Column({ name: 'can_infiltrate', type: 'boolean', default: false })
  canInfiltrate: boolean;

  @Column({ name: 'espionage_level', type: 'int', default: 0 })
  espionageLevel: number;

  @Column({ name: 'current_mission', type: 'jsonb', nullable: true })
  currentMission: any;

  @Column({ type: 'jsonb', nullable: true })
  disguise: any;
}
