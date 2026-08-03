import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { TriggerType } from '@constants/enums';

@Entity('scene_triggers')
export class SceneTrigger {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trigger_type', type: 'enum', enum: TriggerType })
  triggerType: TriggerType;

  @Column({ name: 'area_x', type: 'int', default: 0 })
  areaX: number;

  @Column({ name: 'area_y', type: 'int', default: 0 })
  areaY: number;

  @Column({ name: 'area_w', type: 'int', default: 100 })
  areaW: number;

  @Column({ name: 'area_h', type: 'int', default: 100 })
  areaH: number;

  @Column({ name: 'target_scene_id', type: 'bigint', nullable: true })
  targetSceneId: string | null;

  @Column({ name: 'story_id', type: 'int', nullable: true })
  storyId: number | null;

  @Column({ type: 'jsonb', nullable: true })
  condition: Record<string, any> | null;

  @Column({ name: 'once_only', type: 'boolean', default: false })
  onceOnly: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
