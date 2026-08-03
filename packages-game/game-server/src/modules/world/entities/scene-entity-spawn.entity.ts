import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { EntityType } from '@constants/enums';

@Entity('scene_entity_spawns')
@Index('idx_spawn_scene', ['sceneId'])
export class SceneEntitySpawn {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'scene_id', type: 'bigint' })
  sceneId: string;

  @Column({ name: 'entity_type', type: 'enum', enum: EntityType })
  entityType: EntityType;

  @Column({ name: 'template_id', type: 'bigint' })
  templateId: string;

  @Column({ name: 'spawn_x', type: 'int', default: 0 })
  spawnX: number;

  @Column({ name: 'spawn_y', type: 'int', default: 0 })
  spawnY: number;

  @Column({ name: 'spawn_rotation', type: 'int', default: 0 })
  spawnRotation: number;

  @Column({ name: 'spawn_count', type: 'int', default: 1 })
  spawnCount: number;

  @Column({ name: 'spawn_radius', type: 'int', default: 0 })
  spawnRadius: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
