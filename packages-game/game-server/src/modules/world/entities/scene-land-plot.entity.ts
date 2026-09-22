import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { PlotState } from '@constants/enums';

/**
 * 场景地块（S6）
 * 惰性创建：首次在某格子建造时插入；唯一索引 (scene_id,gx,gy) 承担并发互斥。
 */
@Entity('scene_land_plots')
@Index('uq_plot_scene_grid', ['sceneId', 'gx', 'gy'], { unique: true })
export class SceneLandPlot {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'scene_id', type: 'bigint' })
  sceneId: string;

  @Column({ name: 'gx', type: 'int' })
  gx: number;

  @Column({ name: 'gy', type: 'int' })
  gy: number;

  @Column({ name: 'w', type: 'int', default: 1 })
  w: number;

  @Column({ name: 'h', type: 'int', default: 1 })
  h: number;

  @Column({ name: 'state', type: 'enum', enum: PlotState, default: PlotState.EMPTY })
  state: PlotState;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}