import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn,
} from 'typeorm';

@Entity('apps')
export class App {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** 游戏 app 标识（= 内容表 app_scope 值），如 main / gameB */
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** 独立客户端接入凭证（阶段 3 启用鉴权） */
  @Column({ type: 'varchar', length: 128, default: '' })
  apiKey: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
