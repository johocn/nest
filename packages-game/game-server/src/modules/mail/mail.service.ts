import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mail } from './entities';
import { Player } from '@modules/player/entities/player.entity';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { MailSenderType, CurrencyType } from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';

/** 附件发放项（attachmentJson.items 元素，照 spec 既有样例形状） */
interface MailAttachmentItem {
  templateId: string;
  quantity: number;
}

/** 附件发放货币项（attachmentJson.currencies 元素） */
interface MailAttachmentCurrency {
  currencyType: string;
  amount: number;
}

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
    @InjectRepository(Player) private readonly playerRepo: Repository<Player>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
    private readonly inventoryService: InventoryService,
    private readonly economyService: EconomyService,
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
      throw new GameException(ErrorCodes.MAIL_NOT_FOUND, '邮件不存在');
    }
    mail.isRead = true;
    return this.mailRepo.save(mail);
  }

  /**
   * 领取附件：发放 items（背包）与 currencies（货币）后再标记 isClaimed。
   * 发放任一失败即整体抛异常且不标记，玩家可重试；重复领取返回 45002。
   */
  async claimAttachment(
    playerId: string,
    mailId: string,
  ): Promise<ClaimResult> {
    const mail = await this.mailRepo.findOne({
      where: { id: mailId, recipientId: playerId },
    });
    if (!mail) {
      throw new GameException(ErrorCodes.MAIL_NOT_FOUND, '邮件不存在');
    }
    if (mail.isClaimed) {
      throw new GameException(ErrorCodes.MAIL_ATTACHMENT_CLAIMED, '附件已领取');
    }

    const attachment = mail.attachmentJson ?? {};
    const items: MailAttachmentItem[] = Array.isArray(attachment.items)
      ? attachment.items
      : [];
    const currencies: MailAttachmentCurrency[] = Array.isArray(
      attachment.currencies,
    )
      ? attachment.currencies
      : [];
    if (items.length === 0 && currencies.length === 0) {
      throw new GameException(ErrorCodes.MAIL_NO_ATTACHMENT, '邮件无附件');
    }

    // 先发放后标记：任一发放失败不落 isClaimed，可重试
    for (const it of items) {
      if (!it?.templateId || !(Number(it?.quantity) > 0)) continue;
      await this.inventoryService.addItem(
        playerId,
        String(it.templateId),
        Number(it.quantity),
        'mail_claim',
      );
    }
    for (const c of currencies) {
      if (!c?.currencyType || !(Number(c?.amount) > 0)) continue;
      const ct = String(c.currencyType) as CurrencyType;
      if (!Object.values(CurrencyType).includes(ct)) {
        throw new GameException(
          ErrorCodes.PARAM_INVALID,
          `非法货币类型: ${c.currencyType}`,
        );
      }
      await this.economyService.addCurrency(
        playerId,
        ct,
        Number(c.amount),
        'mail',
        'claim_attachment',
        mailId,
      );
    }

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

  async listMailsWithFilter(
    filter: {
      senderType?: MailSenderType;
      recipientId?: string;
      isRead?: boolean;
      isClaimed?: boolean;
    },
    page: number,
    limit: number,
  ): Promise<{ items: Mail[]; total: number }> {
    const where: any = {};
    if (filter.senderType) where.senderType = filter.senderType;
    if (filter.recipientId) where.recipientId = filter.recipientId;
    if (filter.isRead !== undefined) where.isRead = filter.isRead;
    if (filter.isClaimed !== undefined) where.isClaimed = filter.isClaimed;
    const [items, total] = await this.mailRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async updateMail(
    id: string,
    data: Partial<Pick<Mail, 'title' | 'content' | 'attachmentJson' | 'expiredAt'>>,
  ): Promise<Mail | null> {
    const mail = await this.mailRepo.findOne({ where: { id } });
    if (!mail) return null;
    Object.assign(mail, data);
    return this.mailRepo.save(mail);
  }

  async deleteMail(id: string): Promise<boolean> {
    const result = await this.mailRepo.delete(id);
    return (result.affected ?? 0) > 0;
  }

  /**
   * 面向 admin-web 的增强版批量发送：
   * 支持 targetType: all / level / vip / playerIds / online
   */
  async sendBatchWithTarget(dto: {
    targetType: 'all' | 'level' | 'vip' | 'playerIds' | 'online';
    targetValue?: string | number;
    senderType: MailSenderType;
    title: string;
    content: string;
    attachmentJson?: Record<string, any>;
  }): Promise<BatchMailResult> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    let playerIds: string[] = [];

    switch (dto.targetType) {
      case 'all': {
        const players = await this.playerRepo.find({
          select: { id: true } as any,
        });
        playerIds = players.map((p) => p.id);
        break;
      }
      case 'online': {
        playerIds = await this.cacheService.sMembers('online:players');
        break;
      }
      case 'level': {
        const range = String(dto.targetValue ?? '1');
        const [min, max] = range.includes('-')
          ? range.split('-').map(Number)
          : [Number(range), Number(range)];
        const players = await this.playerRepo
          .createQueryBuilder('p')
          .where('p.level BETWEEN :min AND :max', { min, max })
          .select('p.id')
          .getMany();
        playerIds = players.map((p) => p.id);
        break;
      }
      case 'vip': {
        const vipLevel =
          Number(String(dto.targetValue ?? '1').replace(/\D/g, '')) || 1;
        const players = await this.playerRepo
          .createQueryBuilder('p')
          .where('p.vip_level >= :vipLevel', { vipLevel })
          .select('p.id')
          .getMany();
        playerIds = players.map((p) => p.id);
        break;
      }
      case 'playerIds': {
        playerIds = String(dto.targetValue ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      }
    }

    if (playerIds.length === 0) {
      return { count: 0, batchId };
    }

    // 批量创建并保存
    const mails = this.mailRepo.create(
      playerIds.map((pid) => ({
        recipientId: pid,
        senderType: dto.senderType,
        title: dto.title,
        content: dto.content,
        attachmentJson: dto.attachmentJson ?? {},
        batchId,
      })),
    );
    await this.mailRepo.save(mails);

    return { count: mails.length, batchId };
  }
}
