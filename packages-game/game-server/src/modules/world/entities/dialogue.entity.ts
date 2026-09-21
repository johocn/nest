import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * 对话树（S5）
 * 整棵树以 jsonb 存于 nodes，单表不拆节点子表。
 * 节点形状（仅约定，无子表）：
 *   { key, speaker?, text, condition?, options: [{ text, next?, action?, actionArgs? }] }
 * 其中 condition 为节点级玩家条件；选项无 condition 字段；next 为空表示对话结束。
 */
@Entity('dialogues')
@Index('uq_dialogue_code', ['code'], { unique: true })
export class Dialogue {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'code', type: 'varchar', length: 64 })
  code: string;

  @Column({ name: 'title', type: 'varchar', length: 128 })
  title: string;

  @Column({ name: 'nodes', type: 'jsonb', default: () => "'[]'" })
  nodes: Record<string, any>[];

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
