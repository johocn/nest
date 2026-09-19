import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notice, NoticeReaction } from './entities';
import { NoticeType, NoticeReactionType } from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';

@Injectable()
export class NoticeService {
  constructor(
    @InjectRepository(Notice) private readonly noticeRepo: Repository<Notice>,
    @InjectRepository(NoticeReaction)
    private readonly reactionRepo: Repository<NoticeReaction>,
    private readonly eventBus: EventBusService,
  ) {}

  async react(
    noticeId: string,
    playerId: string,
    reactionType: NoticeReactionType,
  ): Promise<{ noticeId: string; reactionType: NoticeReactionType; likes: number; acks: number }> {
    const notice = await this.noticeRepo.findOne({ where: { id: noticeId } });
    if (!notice) {
      throw new GameException(ErrorCodes.NOTICE_REACTION_EXISTS, '公告不存在');
    }

    const existing = await this.reactionRepo.findOne({
      where: { noticeId, playerId, reactionType },
    });
    if (existing) {
      throw new GameException(
        ErrorCodes.NOTICE_REACTION_EXISTS,
        '已对该公告做出该互动',
      );
    }

    await this.reactionRepo.save(
      this.reactionRepo.create({ noticeId, playerId, reactionType }),
    );

    if (reactionType === NoticeReactionType.LIKE) {
      notice.likeCount += 1;
    } else {
      notice.ackCount += 1;
    }
    await this.noticeRepo.save(notice);

    this.eventBus.emit(GameEvents.NOTICE_REACTED, {
      noticeId,
      playerId,
      reactionType,
    });

    return {
      noticeId,
      reactionType,
      likes: notice.likeCount,
      acks: notice.ackCount,
    };
  }

  async getReactions(
    noticeId: string,
  ): Promise<{ noticeId: string; likes: number; acks: number }> {
    const notice = await this.noticeRepo.findOne({ where: { id: noticeId } });
    if (!notice) {
      throw new GameException(ErrorCodes.NOTICE_REACTION_EXISTS, '公告不存在');
    }
    return {
      noticeId,
      likes: notice.likeCount,
      acks: notice.ackCount,
    };
  }

  async getActiveNotices(): Promise<Notice[]> {
    return this.noticeRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  async getNoticesByType(type: NoticeType): Promise<Notice[]> {
    return this.noticeRepo.find({
      where: { noticeType: type, isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  async getLoginNotices(): Promise<Notice[]> {
    return this.getNoticesByType(NoticeType.LOGIN);
  }

  async createNotice(data: Partial<Notice>): Promise<Notice> {
    const notice = this.noticeRepo.create(data);
    return this.noticeRepo.save(notice);
  }

  async updateNotice(
    id: string,
    data: Partial<Notice>,
  ): Promise<Notice | null> {
    const notice = await this.noticeRepo.findOne({ where: { id } });
    if (!notice) return null;
    Object.assign(notice, data);
    return this.noticeRepo.save(notice);
  }

  async getNotice(id: string): Promise<Notice | null> {
    return this.noticeRepo.findOne({ where: { id } });
  }

  async getNoticeList(
    page: number,
    limit: number,
  ): Promise<{ items: Notice[]; total: number }> {
    const [items, total] = await this.noticeRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }
}
