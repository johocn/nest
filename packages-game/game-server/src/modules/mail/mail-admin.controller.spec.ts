import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { MailAdminController } from './mail-admin.controller';
import { MailService } from './mail.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { MailSenderType } from '@constants/enums';

describe('MailAdminController', () => {
  let ctrl: MailAdminController;
  const mailService = {
    listMailsWithFilter: jest.fn(),
    sendMail: jest.fn(),
    sendBatchWithTarget: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [MailAdminController],
      providers: [
        { provide: MailService, useValue: mailService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(MailAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', MailAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  describe('listMails', () => {
    it('无筛选参数 → isRead/isClaimed 为 undefined', async () => {
      mailService.listMailsWithFilter.mockResolvedValue({ list: [], total: 0 });
      await ctrl.listMails(undefined, undefined, undefined, undefined, '1', '20');
      expect(mailService.listMailsWithFilter).toHaveBeenCalledWith(
        { senderType: undefined, recipientId: undefined, isRead: undefined, isClaimed: undefined },
        1,
        20,
      );
    });

    it('传入 isRead=true → 布尔值正确解析', async () => {
      mailService.listMailsWithFilter.mockResolvedValue({ list: [], total: 0 });
      await ctrl.listMails(undefined, undefined, 'true', 'false', '2', '10');
      expect(mailService.listMailsWithFilter).toHaveBeenCalledWith(
        expect.objectContaining({ isRead: true, isClaimed: false }),
        2,
        10,
      );
    });
  });

  describe('sendMail', () => {
    it('type=gm → senderType 映射为 ADMIN', async () => {
      mailService.sendMail.mockResolvedValue({ id: 'm1' });
      const res = await ctrl.sendMail({ playerId: 'p1', title: 'Hi', type: 'gm', content: '你好' });
      expect(mailService.sendMail).toHaveBeenCalledWith({
        recipientId: 'p1',
        senderType: MailSenderType.ADMIN,
        title: 'Hi',
        content: '你好',
      });
      expect(res).toEqual({ id: 'm1' });
    });

    it('type=system → senderType 映射为 SYSTEM', async () => {
      await ctrl.sendMail({ playerId: 'p1', title: '公告', type: 'system', content: '内容' });
      expect(mailService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ senderType: MailSenderType.SYSTEM }),
      );
    });

    it('type 未提供 → 默认 ADMIN', async () => {
      await ctrl.sendMail({ playerId: 'p1', title: 'Hi', content: '你好' });
      expect(mailService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ senderType: MailSenderType.ADMIN }),
      );
    });
  });

  describe('batchSendMail', () => {
    it('targetType=all → 透传给 service', async () => {
      mailService.sendBatchWithTarget.mockResolvedValue({ sent: 1000 });
      const res = await ctrl.batchSendMail({
        type: 'system',
        targetType: 'all',
        title: '全服公告',
        content: '大家好',
      });
      expect(mailService.sendBatchWithTarget).toHaveBeenCalledWith({
        senderType: MailSenderType.SYSTEM,
        targetType: 'all',
        targetValue: undefined,
        title: '全服公告',
        content: '大家好',
      });
      expect(res).toEqual({ sent: 1000 });
    });

    it('targetType=playerIds + targetValue → 正确透传', async () => {
      mailService.sendBatchWithTarget.mockResolvedValue({ sent: 3 });
      const res = await ctrl.batchSendMail({
        type: 'gm',
        targetType: 'playerIds',
        targetValue: 'p1,p2,p3',
        title: '定向通知',
        content: '你有新任务',
      });
      expect(mailService.sendBatchWithTarget).toHaveBeenCalledWith({
        senderType: MailSenderType.ADMIN,
        targetType: 'playerIds',
        targetValue: 'p1,p2,p3',
        title: '定向通知',
        content: '你有新任务',
      });
      expect(res).toEqual({ sent: 3 });
    });
  });
});
