import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { SceneType, SceneStatus } from '@constants/enums';

@Entity('scenes')
export class Scene {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({
    name: 'scene_type',
    type: 'enum',
    enum: SceneType,
    default: SceneType.TOWN,
  })
  sceneType: SceneType;

  @Column({ name: 'map_res_key', type: 'varchar', length: 128 })
  mapResKey: string;

  @Column({ name: 'map_width', type: 'int', default: 1000 })
  mapWidth: number;

  @Column({ name: 'map_height', type: 'int', default: 1000 })
  mapHeight: number;

  @Column({ name: 'layer_config', type: 'jsonb', default: '{}' })
  layerConfig: Record<string, any>;

  @Column({ name: 'refresh_rule', type: 'jsonb', nullable: true })
  refreshRule: Record<string, any> | null;

  @Column({ name: 'trigger_group_ids', type: 'int', array: true, default: [] })
  triggerGroupIds: number[];

  @Column({ name: 'min_level', type: 'int', default: 1 })
  minLevel: number;

  @Column({ name: 'max_players', type: 'int', default: 100 })
  maxPlayers: number;

  @Column({ type: 'enum', enum: SceneStatus, default: SceneStatus.OPEN })
  status: SceneStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
