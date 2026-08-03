import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';
import { StatPeriod } from '@constants/enums';

@Entity('retention_stats')
@Unique(['statDate', 'cohortDate', 'period'])
export class RetentionStat {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'stat_date', type: 'date' })
  statDate: string;

  @Column({ name: 'cohort_date', type: 'date' })
  cohortDate: string;

  @Column({ type: 'enum', enum: StatPeriod })
  period: StatPeriod;

  @Column({ name: 'cohort_size', type: 'int' })
  cohortSize: number;

  @Column({ name: 'retained_count', type: 'int', default: 0 })
  retainedCount: number;

  @Column({
    name: 'retention_rate',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
  })
  retentionRate: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
