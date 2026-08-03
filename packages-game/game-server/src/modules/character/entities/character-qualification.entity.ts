import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';
import { QualificationType } from '@constants/enums';

@Entity('character_qualifications')
export class CharacterQualification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ type: 'int', default: 2 })
  qualification: number;

  @Column({
    name: 'qualification_type',
    type: 'enum',
    enum: QualificationType,
    default: QualificationType.NORMAL,
  })
  qualificationType: QualificationType;

  @Column({ name: 'is_consumable', type: 'boolean', default: false })
  isConsumable: boolean;
}
