import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { RiskCaseType, RiskCaseStatus } from '@constants/enums';

@Entity('risk_cases')
@Index('idx_risk_case_status', ['status'])
@Index('idx_risk_case_from_to', ['fromId', 'toId'])
export class RiskCase {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'case_type', type: 'varchar', length: 32 })
  caseType: RiskCaseType;

  @Column({ name: 'risk_score', type: 'int' })
  riskScore: number;

  @Column({ type: 'enum', enum: RiskCaseStatus, default: RiskCaseStatus.OPEN })
  status: RiskCaseStatus;

  @Column({ name: 'from_id', type: 'varchar', length: 64 })
  fromId: string;

  @Column({ name: 'to_id', type: 'varchar', length: 64 })
  toId: string;

  @Column({ name: 'detail_json', type: 'jsonb', default: '{}' })
  detailJson: Record<string, any>;

  @Column({ name: 'wf_ids', type: 'jsonb', default: '[]' })
  wfIds: string[];

  @Column({ name: 'handled_by', type: 'varchar', length: 64, nullable: true })
  handledBy: string | null;

  @Column({ name: 'handled_at', type: 'timestamptz', nullable: true })
  handledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}