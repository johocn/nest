import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('account_login_logs')
export class AccountLoginLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  // 无外键：登录失败且账号不存在时记录哨兵值 '0'（写 FK 会违反约束 → 90004）
  @Index()
  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

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
