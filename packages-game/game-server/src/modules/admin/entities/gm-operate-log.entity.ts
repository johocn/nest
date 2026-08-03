import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('gm_operate_logs')
@Index('idx_gmlog_admin', ['adminId'])
@Index('idx_gmlog_target', ['targetPlayerId'])
export class GmOperateLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'admin_id', type: 'bigint' })
  adminId: string;

  @Column({ name: 'target_player_id', type: 'bigint', nullable: true })
  targetPlayerId: string | null;

  @Column({ type: 'varchar', length: 255 })
  operation: string;

  @Column({ name: 'change_before', type: 'jsonb', default: '{}' })
  changeBefore: Record<string, any>;

  @Column({ name: 'change_after', type: 'jsonb', default: '{}' })
  changeAfter: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
