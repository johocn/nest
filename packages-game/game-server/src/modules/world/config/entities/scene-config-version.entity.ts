import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { SceneConfigStatus } from '@constants/enums';

/**
 * 场景配置包版本（配置包导出的唯一真源）。
 *
 * hash 与 payloadHash 语义不同，不得混用：
 * - hash：**配置文件文本**的 sha256（与 manifest.json 中同场景条目的 hash 一致，客户端据此校验文件）；
 * - payloadHash：**包内 hash 字段**，即 canonicalJson(payload) 的 sha256（不含 hash 自身）。
 */
@Entity('scene_config_versions')
@Index('idx_scene_config_ver_scene_version', ['sceneId', 'version'], {
  unique: true,
})
@Index('idx_scene_config_ver_scene_status', ['sceneId', 'status'])
export class SceneConfigVersion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'scene_id', type: 'bigint' })
  sceneId: string;

  @Column({ type: 'int' })
  version: number;

  /** 配置文件文本的 sha256（与 manifest 一致） */
  @Column({ type: 'varchar', length: 80 })
  hash: string;

  @Column({ name: 'file_path', type: 'varchar', length: 255 })
  filePath: string;

  @Column({
    type: 'enum',
    enum: SceneConfigStatus,
    default: SceneConfigStatus.DRAFT,
  })
  status: SceneConfigStatus;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  /** 包内 hash 字段：canonicalJson(payload) 的 sha256（与 hash 不同） */
  @Column({ name: 'payload_hash', type: 'varchar', length: 80 })
  payloadHash: string;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}