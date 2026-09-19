import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  UpdateDateColumn,
} from 'typeorm';
import { ChatChannel } from '@constants/enums';

@Entity('chat_player_stats')
@Index('idx_chat_stat_player_channel', ['playerId', 'channel'], { unique: true })
export class ChatPlayerStat {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'enum', enum: ChatChannel })
  channel: ChatChannel;

  @Column({ name: 'msg_count', type: 'int', default: 0 })
  msgCount: number;

  @Column({ type: 'int', default: 0 })
  level: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
