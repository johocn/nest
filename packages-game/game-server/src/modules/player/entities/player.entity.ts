import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

@Entity('players')
export class Player {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index({ unique: true })
  @Column({ name: 'account_id', type: 'bigint' })
  accountId: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  nickname: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 255, nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ type: 'bigint', default: '0' })
  exp: string;

  @Column({ name: 'vip_level', type: 'int', default: 0 })
  vipLevel: number;

  @Column({ name: 'vip_exp', type: 'int', default: 0 })
  vipExp: number;

  @Column({ name: 'total_recharge', type: 'bigint', default: '0' })
  totalRecharge: string;

  @Column({
    name: 'safe_password_hash',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  safePasswordHash: string | null;

  @Column({ name: 'last_activity_at', type: 'timestamp', nullable: true })
  lastActivityAt: Date | null;

  @Column({ name: 'last_logout_at', type: 'timestamp', nullable: true })
  lastLogoutAt: Date | null;

  @Column({ name: 'online_status', type: 'boolean', default: false })
  onlineStatus: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
