import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';

@Entity('character_statuses')
export class CharacterStatus {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ type: 'int', default: 100 })
  health: number;

  @Column({ type: 'int', default: 100 })
  mana: number;

  @Column({ name: 'max_mana', type: 'int', default: 100 })
  maxMana: number;

  @Column({ type: 'bigint', default: '0' })
  wealth: string;

  @Column({ type: 'int', default: 50 })
  reputation: number;

  @Column({ name: 'is_alive', type: 'boolean', default: true })
  isAlive: boolean;

  @Column({ name: 'death_cause', type: 'varchar', length: 255, nullable: true })
  deathCause: string | null;

  @Column({ name: 'death_date', type: 'timestamp', nullable: true })
  deathDate: Date | null;

  @Column({ type: 'int', default: 1 })
  season: number;

  @Column({ type: 'jsonb', default: [] })
  family: any;
}
