import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SocialPointType, SocialPointReason } from '@constants/enums';

@Entity('social_point_records')
@Index('idx_point_player_created', ['playerId', 'createdAt'])
@Index('idx_point_player_reason', ['playerId', 'reason'])
export class SocialPointRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'enum', enum: SocialPointType })
  type: SocialPointType;

  @Column({ type: 'int' })
  amount: number;

  @Column({ name: 'balance_after', type: 'int' })
  balanceAfter: number;

  @Column({ type: 'enum', enum: SocialPointReason })
  reason: SocialPointReason;

  @Column({ name: 'ref_id', type: 'varchar', length: 64, nullable: true })
  refId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
