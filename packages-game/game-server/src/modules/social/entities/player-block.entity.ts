import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('player_blocks')
@Index('idx_block_pair', ['playerId', 'blockedId'], { unique: true })
@Index('idx_block_blocked', ['blockedId'])
export class PlayerBlock {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'blocked_id', type: 'bigint' })
  blockedId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
