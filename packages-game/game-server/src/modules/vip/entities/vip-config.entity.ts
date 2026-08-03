import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('vip_configs')
export class VipConfig {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'int', unique: true })
  level: number;

  @Column({ name: 'required_exp', type: 'int' })
  requiredExp: number;

  @Column({ name: 'daily_reward_json', type: 'jsonb', default: '{}' })
  dailyRewardJson: Record<string, any>;

  @Column({ name: 'privilege_json', type: 'jsonb', default: '{}' })
  privilegeJson: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
