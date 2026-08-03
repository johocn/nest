import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';
import { Faction } from '@constants/enums';

@Entity('character_factions')
export class CharacterFaction {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ type: 'enum', enum: Faction, default: Faction.NEUTRAL })
  faction: Faction;

  @Column({
    name: 'faction_name',
    type: 'varchar',
    length: 20,
    default: '中立',
  })
  factionName: string;

  @Column({ name: 'faction_level', type: 'int', default: 5 })
  factionLevel: number;

  @Column({
    name: 'faction_title',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  factionTitle: string | null;

  @Column({
    name: 'faction_relations',
    type: 'jsonb',
    default: { righteous: 0, evil: 0, neutral: 0 },
  })
  factionRelations: any;
}
