import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AmbassadorStatus } from '@constants/enums';

@Entity('player_ambassadors')
@Index('idx_ambassador_player', ['playerId'])
@Index('idx_ambassador_status', ['status'])
export class PlayerAmbassador {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'enum', enum: AmbassadorStatus, default: AmbassadorStatus.ACTIVE })
  status: AmbassadorStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  remark: string | null;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: string;

  @Column({ name: 'appointed_at', type: 'timestamp' })
  appointedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
