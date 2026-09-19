import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('character_titles')
@Index(['characterId', 'titleId'], { unique: true })
export class CharacterTitle {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @Column({ name: 'title_id', type: 'bigint' })
  titleId: string;

  @Column({ name: 'is_equipped', type: 'boolean', default: false })
  isEquipped: boolean;

  @CreateDateColumn({ name: 'obtained_at' })
  obtainedAt: Date;
}
