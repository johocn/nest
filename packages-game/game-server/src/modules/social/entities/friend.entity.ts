import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { FriendStatus } from '@constants/enums';

@Entity('friends')
@Index('idx_friend_player', ['playerId'])
@Index('idx_friend_target', ['friendId'])
export class Friend {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ name: 'friend_id', type: 'bigint' })
  friendId: string;

  @Column({ type: 'enum', enum: FriendStatus, default: FriendStatus.PENDING })
  status: FriendStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  remark: string | null;

  @Column({ name: 'last_chat_time', type: 'timestamp', nullable: true })
  lastChatTime: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
