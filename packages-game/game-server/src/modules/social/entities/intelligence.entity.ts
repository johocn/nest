import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import {
  IntelligenceGrade,
  IntelType,
  IntelSourceType,
  IntelStatus,
} from '@constants/enums';

@Entity('intelligences')
@Index('idx_intelligence_owner_status', ['ownerId', 'status'])
@Index('idx_intelligence_listed', ['isListed'])
export class Intelligence {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'owner_id', type: 'bigint' })
  ownerId: string;

  @Column({ type: 'enum', enum: IntelligenceGrade })
  grade: IntelligenceGrade;

  @Column({ name: 'intel_type', type: 'enum', enum: IntelType })
  intelType: IntelType;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'source_type', type: 'enum', enum: IntelSourceType })
  sourceType: IntelSourceType;

  @Column({ name: 'source_id', type: 'varchar', length: 64, nullable: true })
  sourceId: string | null;

  @Column({ name: 'freshness_expire_at', type: 'timestamp', nullable: true })
  freshnessExpireAt: Date | null;

  @Column({ name: 'is_listed', type: 'boolean', default: false })
  isListed: boolean;

  @Column({ type: 'bigint', nullable: true })
  price: string | null;

  @Column({ name: 'seller_trace', type: 'jsonb', nullable: true })
  sellerTrace: any;

  @Column({ type: 'enum', enum: IntelStatus, default: IntelStatus.ACTIVE })
  status: IntelStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
