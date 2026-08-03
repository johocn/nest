import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { BuffType, BuffTarget } from '@constants/enums';

@Entity('buff_templates')
export class BuffTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'enum', enum: BuffType, default: BuffType.BUFF })
  buffType: BuffType;

  @Column({ type: 'enum', enum: BuffTarget, default: BuffTarget.TARGET })
  target: BuffTarget;

  @Column({ name: 'duration', type: 'int', default: 10 })
  duration: number;

  @Column({ name: 'stat_modifiers', type: 'jsonb', default: '{}' })
  statModifiers: Record<string, number>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'icon_key', type: 'varchar', length: 128, nullable: true })
  iconKey: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
