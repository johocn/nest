import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('player_mounts')
@Index(['characterId', 'mountId'], { unique: true })
export class PlayerMount {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'character_id', type: 'bigint' })
  characterId: string;

  @Column({ name: 'mount_id', type: 'bigint' })
  mountId: string;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @CreateDateColumn({ name: 'obtained_at' })
  obtainedAt: Date;
}
