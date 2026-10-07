import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { NpcInteractType } from '@constants/enums';
import { COMMON_SCOPE } from '@shared/content-scope';

@Entity('npc_templates')
export class NpcTemplate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'res_key', type: 'varchar', length: 128 })
  resKey: string;

  @Column({ type: 'float', default: 1.0 })
  scale: number;

  @Column({ name: 'default_anim', type: 'varchar', length: 64, nullable: true })
  defaultAnim: string | null;

  @Column({
    name: 'interact_type',
    type: 'enum',
    enum: NpcInteractType,
    default: NpcInteractType.TALK,
  })
  interactType: NpcInteractType;

  @Column({ name: 'dialogue_id', type: 'int', nullable: true })
  dialogueId: number | null;

  @Column({ name: 'move_range', type: 'int', default: 0 })
  moveRange: number;

  @Column({ name: 'is_auto_wander', type: 'boolean', default: false })
  isAutoWander: boolean;

  @Column({ type: 'jsonb', default: '{}' })
  attr: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @Column({ name: 'app_scope', type: 'varchar', length: 32, default: COMMON_SCOPE })
  appScope: string;
}
