import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';
import { RelationshipLevel, RelationshipStatus } from '@constants/enums';

@Entity('character_relationships')
@Index(['characterId', 'targetId'])
export class CharacterRelationship {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @Column({ name: 'target_id', type: 'bigint' })
  targetId: string;

  @Column({ type: 'int', default: 0 })
  favorability: number;

  @Column({
    type: 'enum',
    enum: RelationshipLevel,
    default: RelationshipLevel.STRANGER,
  })
  level: RelationshipLevel;

  @Column({
    type: 'enum',
    enum: RelationshipStatus,
    default: RelationshipStatus.NORMAL,
  })
  status: RelationshipStatus;

  @Column({ type: 'jsonb', default: [] })
  history: any;

  @Column({ type: 'jsonb', default: {} })
  triggers: any;
}
