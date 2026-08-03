import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('drop_templates')
export class DropTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'drop_items', type: 'jsonb', default: '[]' })
  dropItems: Array<{
    itemTemplateId: string;
    weight: number;
    minQty: number;
    maxQty: number;
  }>;

  @Column({ name: 'drop_rate', type: 'float', default: 1.0 })
  dropRate: number;

  @Column({ name: 'max_drops', type: 'int', default: 1 })
  maxDrops: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
