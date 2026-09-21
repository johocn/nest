import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { NpcPatrolLoopMode } from '@constants/enums';

@Entity('npc_patrol_routes')
@Index('idx_npc_patrol_route_scene', ['sceneId'])
export class NpcPatrolRoute {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'scene_id', type: 'bigint' })
  sceneId: string;

  @Column({ name: 'npc_template_id', type: 'bigint' })
  npcTemplateId: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({
    name: 'loop_mode',
    type: 'enum',
    enum: NpcPatrolLoopMode,
    default: NpcPatrolLoopMode.LOOP,
  })
  loopMode: NpcPatrolLoopMode;

  @Column({ type: 'int', default: 60 })
  speed: number;

  // 路点数组，元素形如 { x, y, pauseSec }
  @Column({ type: 'jsonb', default: '[]' })
  points: Array<Record<string, any>>;

  // 巡逻时段（本批仅存储，不消费）
  @Column({ type: 'jsonb', nullable: true })
  schedule: Record<string, any> | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
