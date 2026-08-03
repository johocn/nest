import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { AccountType, AccountStatus } from '@constants/enums';

@Entity('auth_accounts')
export class AuthAccount {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  username: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 128 })
  passwordHash: string;

  @Column({
    name: 'account_type',
    type: 'enum',
    enum: AccountType,
    default: AccountType.NORMAL,
  })
  accountType: AccountType;

  @Column({ name: 'device_id', type: 'varchar', length: 128, nullable: true })
  deviceId: string | null;

  @Column({ name: 'bind_phone', type: 'varchar', length: 20, nullable: true })
  bindPhone: string | null;

  @Column({ name: 'bind_email', type: 'varchar', length: 128, nullable: true })
  bindEmail: string | null;

  @Column({ name: 'ban_reason', type: 'varchar', length: 255, nullable: true })
  banReason: string | null;

  @Column({ name: 'ban_expire_at', type: 'timestamp', nullable: true })
  banExpireAt: Date | null;

  @Column({ name: 'token_version', type: 'int', default: 0 })
  tokenVersion: number;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @Column({ type: 'enum', enum: AccountStatus, default: AccountStatus.ACTIVE })
  status: AccountStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
