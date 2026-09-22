import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * 建筑蓝图（S6，配置数据）
 * build_cost 元素形状：{ itemTemplateId?, currencyType?, amount }
 * effect 只落契约，不生效（S6 明确不做建筑效果）。
 */
@Entity('building_templates')
export class BuildingTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'res_key', type: 'varchar', length: 128 })
  resKey: string;

  @Column({ name: 'category', type: 'varchar', length: 32 })
  category: string;

  @Column({ name: 'footprint_w', type: 'int', default: 1 })
  footprintW: number;

  @Column({ name: 'footprint_h', type: 'int', default: 1 })
  footprintH: number;

  @Column({ name: 'build_cost', type: 'jsonb', default: () => "'[]'" })
  buildCost: Record<string, any>[];

  @Column({ name: 'build_seconds', type: 'int', default: 60 })
  buildSeconds: number;

  @Column({ name: 'durability', type: 'int', default: 100 })
  durability: number;

  @Column({ name: 'effect', type: 'jsonb', default: () => "'{}'" })
  effect: Record<string, any>;

  @Column({ name: 'unlock_condition', type: 'jsonb', nullable: true })
  unlockCondition: Record<string, any> | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}