import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('trigger_unlocks')
export class TriggerUnlock {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'trigger_id', type: 'bigint' })
  triggerId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @CreateDateColumn({ name: 'unlocked_at' })
  unlockedAt: Date;
}
