import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Character } from './character.entity';
import { CompanionType } from '@constants/enums';

@Entity('character_companions')
export class CharacterCompanion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @OneToOne(() => Character)
  @JoinColumn({ name: 'character_id' })
  character: Character;

  @Column({ name: 'is_following', type: 'boolean', default: false })
  isFollowing: boolean;

  @Column({ name: 'follow_start_at', type: 'timestamp', nullable: true })
  followStartAt: Date | null;

  @Column({ name: 'follow_end_at', type: 'timestamp', nullable: true })
  followEndAt: Date | null;

  @Column({
    name: 'companion_type',
    type: 'enum',
    enum: CompanionType,
    default: CompanionType.NONE,
  })
  companionType: CompanionType;

  @Column({ name: 'owner_id', type: 'bigint', nullable: true })
  ownerId: string | null;

  @Column({ name: 'sacrifice_used', type: 'boolean', default: false })
  sacrificeUsed: boolean;

  @Column({ name: 'last_words', type: 'varchar', length: 255, nullable: true })
  lastWords: string | null;
}
