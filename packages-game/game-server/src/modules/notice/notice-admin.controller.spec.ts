import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { NoticeAdminController } from './notice-admin.controller';
import { NoticeService } from './notice.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('NoticeAdminController', () => {
  let ctrl: NoticeAdminController;
  const noticeService = {
    getNoticeList: jest.fn(),
    getNotice: jest.fn(),
    createNotice: jest.fn(),
    updateNotice: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [NoticeAdminController],
      providers: [
        { provide: NoticeService, useValue: noticeService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(NoticeAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', NoticeAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  describe('listNotices', () => {
    it('调用 service.getNoticeList 并返回 fromEntity 映射后的 items', async () => {
      const raw = {
        items: [{ id: 'n1', title: '公告', noticeType: 'popup', content: '维护内容', isActive: true }],
        total: 1,
        page: 1,
        limit: 20,
      };
      noticeService.getNoticeList.mockResolvedValue(raw);
      const res = await ctrl.listNotices('1', '20');
      expect(noticeService.getNoticeList).toHaveBeenCalledWith(1, 20);
      expect(res.items[0].type).toBe('announcement');
    });
  });

  describe('getNotice', () => {
    it('调用 service.getNotice 并返回 fromEntity 结果', async () => {
      noticeService.getNotice.mockResolvedValue({ id: 'n1', noticeType: 'banner', title: '维护公告' });
      const res = await ctrl.getNotice('n1');
      expect(noticeService.getNotice).toHaveBeenCalledWith('n1');
      expect(res.type).toBe('maintenance');
    });
  });

  describe('createNotice', () => {
    it('调用 service.createNotice 并返回 fromEntity 结果', async () => {
      const created = { id: 'n1', noticeType: 'login', title: '新活动', content: '活动内容', isActive: true };
      noticeService.createNotice.mockResolvedValue(created);
      const res = await ctrl.createNotice({ title: '新活动', type: 'activity' });
      expect(noticeService.createNotice).toHaveBeenCalledWith(
        expect.objectContaining({ noticeType: 'login' }),
      );
      expect(res.type).toBe('activity');
    });
  });

  describe('updateNotice', () => {
    it('调用 service.updateNotice 并返回 fromEntity 结果', async () => {
      const updated = { id: 'n1', noticeType: 'popup', title: '更新后', content: '新内容' };
      noticeService.updateNotice.mockResolvedValue(updated);
      const res = await ctrl.updateNotice('n1', { title: '更新后', type: 'announcement' });
      expect(noticeService.updateNotice).toHaveBeenCalledWith(
        'n1',
        expect.objectContaining({ noticeType: 'popup' }),
      );
      expect(res.title).toBe('更新后');
    });
  });
});
