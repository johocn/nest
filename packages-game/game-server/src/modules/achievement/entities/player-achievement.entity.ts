import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('player_achievements')
@Unique(['playerId', 'achievementId'])
export class PlayerAchievement {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'achievement_id', type: 'varchar', length: 64 })
  achievementId: string;

  @Column({ name: 'current_value', type: 'int', default: 0 })
  currentValue: number;

  @Column({ name: 'is_unlocked', type: 'boolean', default: false })
  isUnlocked: boolean;

  @Column({ name: 'is_reward_claimed', type: 'boolean', default: false })
  isRewardClaimed: boolean;

  @Column({ name: 'unlocked_at', type: 'timestamp', nullable: true })
  unlockedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
