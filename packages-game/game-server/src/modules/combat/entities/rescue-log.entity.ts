import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('rescue_logs')
@Index('idx_rescue_rescuer', ['rescuerId'])
export class RescueLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'rescuer_id', type: 'bigint' })
  rescuerId: string;

  @Column({ name: 'target_id', type: 'bigint' })
  targetId: string;

  @Column({ name: 'combat_log_id', type: 'bigint', nullable: true })
  combatLogId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
