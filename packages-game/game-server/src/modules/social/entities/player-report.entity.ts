import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ReportTargetType, ReportReason, ReportStatus } from '@constants/enums';

@Entity('player_reports')
@Index('idx_report_target', ['targetType', 'targetId'])
@Index('idx_report_status', ['status'])
@Index('idx_report_reporter', ['reporterId'])
export class PlayerReport {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'reporter_id', type: 'bigint' })
  reporterId: string;

  @Column({ name: 'target_type', type: 'enum', enum: ReportTargetType })
  targetType: ReportTargetType;

  @Column({ name: 'target_id', type: 'varchar', length: 64 })
  targetId: string;

  @Column({ type: 'enum', enum: ReportReason })
  reason: ReportReason;

  @Column({ type: 'varchar', length: 500, nullable: true })
  content: string | null;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status: ReportStatus;

  @Column({ name: 'handler_admin_id', type: 'bigint', nullable: true })
  handlerAdminId: string | null;

  @Column({ name: 'handle_action', type: 'varchar', length: 32, nullable: true })
  handleAction: string | null;

  @Column({ name: 'handle_remark', type: 'varchar', length: 255, nullable: true })
  handleRemark: string | null;

  @Column({ name: 'handled_at', type: 'timestamp', nullable: true })
  handledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
