import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('config_versions')
@Index('idx_cfgver_key', ['configKey', 'version'])
export class ConfigVersion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'config_key', type: 'varchar', length: 128 })
  configKey: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'text' })
  value: string;

  @Column({ name: 'created_by', type: 'bigint', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
