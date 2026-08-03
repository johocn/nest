import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { SkillType, MartialArtType } from '@constants/enums';

@Entity('skill_templates')
export class SkillTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({
    name: 'skill_type',
    type: 'enum',
    enum: SkillType,
    default: SkillType.ACTIVE,
  })
  skillType: SkillType;

  @Column({
    name: 'art_type',
    type: 'enum',
    enum: MartialArtType,
    nullable: true,
  })
  artType: MartialArtType | null;

  @Column({ name: 'base_damage', type: 'int', default: 10 })
  baseDamage: number;

  @Column({ type: 'int', default: 5 })
  cooldown: number;

  @Column({ name: 'mp_cost', type: 'int', default: 0 })
  mpCost: number;

  @Column({ type: 'int', default: 1 })
  range: number;

  @Column({ name: 'effect_json', type: 'jsonb', default: '{}' })
  effectJson: Record<string, any>;

  @Column({ name: 'min_level', type: 'int', default: 1 })
  minLevel: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
