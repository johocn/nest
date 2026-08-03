import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ChatChannel } from '@constants/enums';

@Entity('chat_messages')
@Index('idx_chat_channel', ['channel'])
@Index('idx_chat_sender', ['senderId'])
@Index('idx_chat_recipient', ['recipientId'])
export class ChatMessage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'enum', enum: ChatChannel })
  channel: ChatChannel;

  @Column({ name: 'sender_id', type: 'bigint' })
  senderId: string;

  @Column({ name: 'sender_name', type: 'varchar', length: 64 })
  senderName: string;

  @Column({ name: 'recipient_id', type: 'bigint', nullable: true })
  recipientId: string | null;

  @Column({ name: 'guild_id', type: 'bigint', nullable: true })
  guildId: string | null;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
