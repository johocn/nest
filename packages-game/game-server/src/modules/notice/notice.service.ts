import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notice } from './entities';
import { NoticeType } from '@constants/enums';

@Injectable()
export class NoticeService {
  constructor(
    @InjectRepository(Notice) private readonly noticeRepo: Repository<Notice>,
  ) {}

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
