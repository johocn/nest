import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { PenaltyLevel } from '@constants/enums';

@Entity('account_penalties')
export class AccountPenalty {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'enum', enum: PenaltyLevel })
  level: PenaltyLevel;

  @Column({ type: 'varchar', length: 255 })
  reason: string;

  @Column({ name: 'until', type: 'timestamp', nullable: true })
  until: Date | null;

  @Column({ name: 'created_by', type: 'varchar', length: 64 })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
