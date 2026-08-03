import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ObjectType } from '@constants/enums';

@Entity('object_templates')
export class ObjectTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'res_key', type: 'varchar', length: 128 })
  resKey: string;

  @Column({ type: 'enum', enum: ObjectType, default: ObjectType.CHEST })
  type: ObjectType;

  @Column({ name: 'interact_cd', type: 'int', default: 0 })
  interactCd: number;

  @Column({ type: 'jsonb', nullable: true })
  reward: Record<string, any> | null;

  @Column({ name: 'anim_open', type: 'varchar', length: 64, nullable: true })
  animOpen: string | null;

  @Column({ name: 'is_one_time', type: 'boolean', default: false })
  isOneTime: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
