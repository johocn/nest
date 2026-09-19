import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { BountyStatus } from '@constants/enums';

@Entity('bounties')
@Index('idx_bounty_status', ['status'])
export class Bounty {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'publisher_id', type: 'bigint' })
  publisherId: string;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  @Column({ name: 'target_json', type: 'jsonb', default: '{}' })
  targetJson: Record<string, any>;

  @Column({ name: 'gold_reward', type: 'bigint' })
  goldReward: string;

  @Column({ type: 'timestamp', nullable: true })
  deadline: Date | null;

  @Column({ name: 'max_acceptors', type: 'int', default: 1 })
  maxAcceptors: number;

  @Column({ name: 'acceptor_id', type: 'bigint', nullable: true })
  acceptorId: string | null;

  @Column({
    type: 'enum',
    enum: BountyStatus,
    default: BountyStatus.ACTIVE,
  })
  status: BountyStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
