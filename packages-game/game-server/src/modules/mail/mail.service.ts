import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mail } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { MailSenderType } from '@constants/enums';

export interface SendMailParams {
  recipientId: string;
  senderType: MailSenderType;
  senderId?: string;
  title: string;
  content: string;
  attachmentJson?: Record<string, any>;
  batchId?: string;
  expiredAt?: Date;
}

export interface ClaimResult {
  attachment: Record<string, any>;
  isClaimed: boolean;
}

export interface BatchMailResult {
  count: number;
  batchId: string;
}

@Injectable()
export class MailService {
  constructor(
    @InjectRepository(Mail) private readonly mailRepo: Repository<Mail>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async getMails(playerId: string): Promise<Mail[]> {
    return this.mailRepo.find({
      where: { recipientId: playerId },
      order: { createdAt: 'DESC' },
    });
  }

  async getMail(id: string): Promise<Mail | null> {
    return this.mailRepo.findOne({ where: { id } });
  }

  async readMail(playerId: string, mailId: string): Promise<Mail> {
    const mail = await this.mailRepo.findOne({
      where: { id: mailId, recipientId: playerId },
    });
    if (!mail) {
      throw new Error('邮件不存在');
    }
    mail.isRead = true;
    return this.mailRepo.save(mail);
  }

  async claimAttachment(
    playerId: string,
    mailId: string,
  ): Promise<ClaimResult> {
    const mail = await this.mailRepo.findOne({
      where: { id: mailId, recipientId: playerId },
    });
    if (!mail) {
      throw new Error('邮件不存在');
    }
    if (mail.isClaimed) {
      throw new Error('附件已领取');
    }

    const attachment = mail.attachmentJson;
    mail.isClaimed = true;
    await this.mailRepo.save(mail);

    return { attachment, isClaimed: true };
  }

  async sendMail(params: SendMailParams): Promise<Mail> {
    const mail = this.mailRepo.create({
      recipientId: params.recipientId,
      senderType: params.senderType,
      senderId: params.senderId ?? null,
      title: params.title,
      content: params.content,
      attachmentJson: params.attachmentJson ?? {},
      batchId: params.batchId ?? null,
      expiredAt: params.expiredAt ?? null,
    });
    const saved = await this.mailRepo.save(mail);

    this.eventBus.emit(GameEvents.MAIL_RECEIVED, {
      recipientId: params.recipientId,
      mailId: saved.id,
      title: params.title,
    });

    return saved;
  }

  async sendBatchMail(
    params: Omit<SendMailParams, 'recipientId'>,
  ): Promise<BatchMailResult> {
    const onlinePlayers = await this.cacheService.sMembers('online:players');
    const batchId = params.batchId ?? `batch_${Date.now()}`;

    for (const playerId of onlinePlayers) {
      await this.sendMail({
        ...params,
        recipientId: playerId,
        batchId,
      });
    }

    return { count: onlinePlayers.length, batchId };
  }

  async getMailList(
    page: number,
    limit: number,
  ): Promise<{ items: Mail[]; total: number }> {
    const [items, total] = await this.mailRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }
}
