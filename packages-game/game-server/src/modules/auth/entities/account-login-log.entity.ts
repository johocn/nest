import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AuthAccount } from './auth-account.entity';

@Entity('account_login_logs')
export class AccountLoginLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @ManyToOne(() => AuthAccount)
  @JoinColumn({ name: 'account_id' })
  account: AuthAccount;

  @Column({ name: 'login_ip', type: 'varchar', length: 45 })
  loginIp: string;

  @Column({ name: 'device_info', type: 'varchar', length: 255, nullable: true })
  deviceInfo: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  region: string | null;

  @Column({ name: 'login_result', type: 'varchar', length: 16 })
  loginResult: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
