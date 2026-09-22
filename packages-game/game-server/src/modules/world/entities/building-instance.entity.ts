import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { BuildingOwnerType, BuildingState } from '@constants/enums';

/**
 * 建筑实例（S6）
 * 一张表承载 building/built/demolishing，用 state + finish_at 表达建造中。
 */
@Entity('building_instances')
@Index('idx_building_instance_scene_state', ['sceneId', 'state'])
export class BuildingInstance {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'scene_id', type: 'bigint' })
  sceneId: string;

  @Column({ name: 'plot_id', type: 'bigint' })
  plotId: string;

  @Column({ name: 'template_id', type: 'bigint' })
  templateId: string;

  @Column({ name: 'owner_type', type: 'enum', enum: BuildingOwnerType })
  ownerType: BuildingOwnerType;

  @Column({ name: 'owner_id', type: 'bigint' })
  ownerId: string;

  @Column({ name: 'state', type: 'enum', enum: BuildingState, default: BuildingState.BUILDING })
  state: BuildingState;

  @Column({ name: 'finish_at', type: 'timestamptz', nullable: true })
  finishAt: Date | null;

  @Column({ name: 'durability', type: 'int' })
  durability: number;

  @Column({ name: 'payload', type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}