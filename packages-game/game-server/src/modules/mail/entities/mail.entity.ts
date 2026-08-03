import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { MailSenderType } from '@constants/enums';

@Entity('mails')
@Index('idx_mail_recipient', ['recipientId'])
@Index('idx_mail_batch', ['batchId'])
export class Mail {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'recipient_id', type: 'bigint', nullable: true })
  recipientId: string | null;

  @Column({
    name: 'sender_type',
    type: 'enum',
    enum: MailSenderType,
    default: MailSenderType.SYSTEM,
  })
  senderType: MailSenderType;

  @Column({ name: 'sender_id', type: 'bigint', nullable: true })
  senderId: string | null;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'attachment_json', type: 'jsonb', default: '{}' })
  attachmentJson: Record<string, any>;

  @Column({ name: 'batch_id', type: 'varchar', length: 64, nullable: true })
  batchId: string | null;

  @Column({ name: 'template_id', type: 'int', nullable: true })
  templateId: number | null;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @Column({ name: 'is_claimed', type: 'boolean', default: false })
  isClaimed: boolean;

  @Column({ name: 'expired_at', type: 'timestamp', nullable: true })
  expiredAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
