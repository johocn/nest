import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { SupportTicketStatus } from '@constants/enums';

@Entity('support_tickets')
@Index('idx_support_player', ['playerId'])
@Index('idx_support_status', ['status'])
export class SupportTicket {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'player_id', type: 'bigint' })
  playerId: string;

  @Column({ type: 'varchar', length: 32 })
  channel: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  keyword: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'enum', enum: SupportTicketStatus })
  status: SupportTicketStatus;

  @Column({ name: 'auto_reply', type: 'text', nullable: true })
  autoReply: string | null;

  @Column({ name: 'gm_reply', type: 'text', nullable: true })
  gmReply: string | null;

  @Column({ name: 'admin_id', type: 'bigint', nullable: true })
  adminId: string | null;

  @Column({ name: 'handled_at', type: 'timestamp', nullable: true })
  handledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
