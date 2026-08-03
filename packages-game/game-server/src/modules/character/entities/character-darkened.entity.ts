import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';

@Entity('character_darkened')
export class CharacterDarkened {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ name: 'is_darkened', type: 'boolean', default: false })
  isDarkened: boolean;

  @Column({ name: 'darkened_at', type: 'timestamp', nullable: true })
  darkenedAt: Date | null;

  @Column({
    name: 'darkened_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  darkenedReason: string | null;

  @Column({
    name: 'original_name',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  originalName: string | null;

  @Column({
    name: 'darkened_name',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  darkenedName: string | null;

  @Column({ name: 'power_boost', type: 'double precision', default: 1.5 })
  powerBoost: number;

  @Column({ name: 'hunting_target', type: 'bigint', nullable: true })
  huntingTarget: string | null;
}
