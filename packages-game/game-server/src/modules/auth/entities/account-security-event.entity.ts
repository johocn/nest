import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('account_security_events')
export class AccountSecurityEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index()
  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Column({ type: 'varchar', length: 32 })
  type: string; // login_risk / verify_ok / verify_fail

  @Column({ name: 'login_ip', type: 'varchar', length: 45, nullable: true })
  loginIp: string | null;

  @Column({ name: 'device_info', type: 'varchar', length: 255, nullable: true })
  deviceInfo: string | null;

  @Column({ type: 'varchar', length: 32, default: 'flagged' })
  result: string; // flagged / ok / fail

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
