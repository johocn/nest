import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { MonsterAiType } from '@constants/enums';

@Entity('monster_templates')
export class MonsterTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'res_key', type: 'varchar', length: 128 })
  resKey: string;

  @Column({ type: 'float', default: 1.0 })
  scale: number;

  @Column({ name: 'base_hp', type: 'bigint', default: '100' })
  baseHp: string;

  @Column({ name: 'base_atk', type: 'int', default: 10 })
  baseAtk: number;

  @Column({ name: 'drop_template_id', type: 'bigint', nullable: true })
  dropTemplateId: string | null;

  @Column({ name: 'refresh_cd', type: 'int', default: 30 })
  refreshCd: number;

  @Column({ name: 'aggro_range', type: 'int', default: 5 })
  aggroRange: number;

  @Column({
    name: 'ai_type',
    type: 'enum',
    enum: MonsterAiType,
    default: MonsterAiType.GUARD,
  })
  aiType: MonsterAiType;

  @Column({ type: 'jsonb', default: '{}' })
  attr: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
