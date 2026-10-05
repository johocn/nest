import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ActivityAdminController } from './activity-admin.controller';
import { ActivityService } from './activity.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('ActivityAdminController', () => {
  let ctrl: ActivityAdminController;
  const activityService = {
    listTemplatesWithFilter: jest.fn(),
    getActivityDashboard: jest.fn(),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    publishActivity: jest.fn(),
    grayVerifyActivity: jest.fn(),
    rollbackActivity: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ActivityAdminController],
      providers: [
        { provide: ActivityService, useValue: activityService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(ActivityAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', ActivityAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  describe('listTemplates', () => {
    it('调用 service.listTemplatesWithFilter 并返回 fromEntity 映射后的 items', async () => {
      const raw = {
        items: [
          {
            id: 'act-1',
            name: '春节活动',
            activityType: 'event',
            status: 'active',
            isActive: true,
            startAt: new Date('2025-02-01'),
            endAt: new Date('2025-02-10'),
            rulesJson: { duration: 10 },
            conditionJson: {},
            rewardJson: { gold: 1000 },
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      };
      activityService.listTemplatesWithFilter.mockResolvedValue(raw);
      const res = await ctrl.listTemplates('active', 'event', '1', '20');
      expect(activityService.listTemplatesWithFilter).toHaveBeenCalledWith(
        { status: 'active', activityType: 'event' },
        1,
        20,
      );
      expect(res.items[0].startTime).toBeInstanceOf(Date);
      expect(res.items[0].rewards).toEqual({ gold: 1000 });
    });
  });

  describe('getDashboard', () => {
    it('未传 days 时默认 7', async () => {
      const dashboard = { participantCount: 100, totalReward: 100000, completionRate: 0.8 };
      activityService.getActivityDashboard.mockResolvedValue(dashboard);
      const res = await ctrl.getDashboard('act-1', undefined);
      expect(activityService.getActivityDashboard).toHaveBeenCalledWith('act-1', 7);
      expect(res).toEqual(dashboard);
    });

    it('传入 days 时正确转 number', async () => {
      await ctrl.getDashboard('act-1', '14');
      expect(activityService.getActivityDashboard).toHaveBeenCalledWith('act-1', 14);
    });
  });

  describe('createTemplate', () => {
    it('调用 service.createTemplate 并返回 fromEntity 结果', async () => {
      const created = {
        id: 'act-1',
        name: '新活动',
        status: 'draft',
        startAt: new Date('2025-03-01'),
        endAt: new Date('2025-03-07'),
        rulesJson: {},
        conditionJson: {},
        rewardJson: { gold: 500 },
      };
      activityService.createTemplate.mockResolvedValue(created);
      const res = await ctrl.createTemplate({
        name: '新活动',
        startTime: '2025-03-01',
        endTime: '2025-03-07',
        rewards: { gold: 500 },
      });
      expect(activityService.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ startAt: expect.any(Date), rewardJson: { gold: 500 } }),
      );
      expect(res.rewards).toEqual({ gold: 500 });
    });
  });

  describe('updateTemplate', () => {
    it('调用 service.updateTemplate 并返回 fromEntity 结果', async () => {
      const updated = {
        id: 'act-1',
        name: '更新后',
        status: 'draft',
        startAt: new Date('2025-03-01'),
        endAt: new Date('2025-03-07'),
        rulesJson: {},
        conditionJson: {},
        rewardJson: {},
      };
      activityService.updateTemplate.mockResolvedValue(updated);
      const res = await ctrl.updateTemplate('act-1', { name: '更新后' });
      expect(activityService.updateTemplate).toHaveBeenCalledWith('act-1', expect.objectContaining({ name: '更新后' }));
      expect(res.name).toBe('更新后');
    });
  });

  describe('publish', () => {
    it('带 grayWhitelist 调用 service.publishActivity', async () => {
      const result = { id: 'act-1', status: 'gray' };
      activityService.publishActivity.mockResolvedValue(result);
      const res = await ctrl.publish({ adminId: 'admin-1' }, 'act-1', { grayWhitelist: ['p1', 'p2'] });
      expect(activityService.publishActivity).toHaveBeenCalledWith('admin-1', 'act-1', ['p1', 'p2']);
      expect(res.status).toBe('gray');
    });

    it('不带 body 时 grayWhitelist 为 undefined', async () => {
      activityService.publishActivity.mockResolvedValue({ id: 'act-1', status: 'active' });
      await ctrl.publish({ adminId: 'admin-2' }, 'act-1', undefined);
      expect(activityService.publishActivity).toHaveBeenCalledWith('admin-2', 'act-1', undefined);
    });
  });

  describe('grayVerify', () => {
    it('调用 service.grayVerifyActivity', async () => {
      const result = { id: 'act-1', status: 'active' };
      activityService.grayVerifyActivity.mockResolvedValue(result);
      const res = await ctrl.grayVerify({ adminId: 'admin-1' }, 'act-1');
      expect(activityService.grayVerifyActivity).toHaveBeenCalledWith('admin-1', 'act-1', true);
      expect(res.status).toBe('active');
    });
  });

  describe('rollback', () => {
    it('调用 service.rollbackActivity', async () => {
      const result = { id: 'act-1', status: 'draft' };
      activityService.rollbackActivity.mockResolvedValue(result);
      const res = await ctrl.rollback({ adminId: 'admin-1' }, 'act-1');
      expect(activityService.rollbackActivity).toHaveBeenCalledWith('admin-1', 'act-1');
      expect(res.status).toBe('draft');
    });
  });
});
