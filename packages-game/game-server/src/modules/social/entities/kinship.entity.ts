import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { KinshipType, KinshipStatus } from '@constants/enums';

@Entity('kinships')
export class Kinship {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'enum', enum: KinshipType })
  type: KinshipType;

  @Column({ type: 'varchar', length: 64, nullable: true })
  name: string | null;

  @Column({ name: 'leader_id', type: 'bigint' })
  leaderId: string;

  @Column({ type: 'jsonb', default: '[]' })
  members: string[];

  @Column({ type: 'enum', enum: KinshipStatus, default: KinshipStatus.ACTIVE })
  status: KinshipStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'disbanded_at' })
  disbandedAt: Date | null;
}
