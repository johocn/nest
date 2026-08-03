import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { BehaviorType } from '@constants/enums';

@Entity('player_behavior_logs')
@Index(['playerId', 'createdAt'])
@Index(['behaviorType', 'createdAt'])
export class PlayerBehaviorLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'varchar', length: 64 })
  playerId: string;

  @Column({ name: 'behavior_type', type: 'enum', enum: BehaviorType })
  behaviorType: BehaviorType;

  @Column({ name: 'detail_json', type: 'jsonb', default: '{}' })
  detailJson: Record<string, any>;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
