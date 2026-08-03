import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServerState } from '@constants/enums';

@Entity('server_statuses')
export class ServerStatus {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'server_name', type: 'varchar', length: 64 })
  serverName: string;

  @Column({
    name: 'state',
    type: 'enum',
    enum: ServerState,
    default: ServerState.RUNNING,
  })
  state: ServerState;

  @Column({ name: 'max_online', type: 'int', default: 0 })
  maxOnline: number;

  @Column({ name: 'current_online', type: 'int', default: 0 })
  currentOnline: number;

  @Column({ name: 'maintenance_message', type: 'text', nullable: true })
  maintenanceMessage: string | null;

  @Column({ name: 'version', type: 'varchar', length: 32, default: '1.0.0' })
  version: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
