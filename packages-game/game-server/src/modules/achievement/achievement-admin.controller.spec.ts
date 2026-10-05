import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AchievementAdminController } from './achievement-admin.controller';
import { AchievementService } from './achievement.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('AchievementAdminController', () => {
  let ctrl: AchievementAdminController;
  const achievementService = {
    listTemplates: jest.fn(),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [AchievementAdminController],
      providers: [
        { provide: AchievementService, useValue: achievementService },
        // AdminGuard 依赖
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(AchievementAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', AchievementAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  describe('listTemplates', () => {
    it('调用 service.listTemplates 并返回 fromEntity 映射后的 items', async () => {
      const raw = {
        items: [
          { id: 'a1', name: '屠龙', targetValue: 100, rewardJson: { gold: 1000 }, condition: 'KILL_COUNT', conditionJson: {} },
        ],
        total: 1,
        page: 1,
        limit: 20,
      };
      achievementService.listTemplates.mockResolvedValue(raw);
      const res = await ctrl.listTemplates('1', '20');
      expect(achievementService.listTemplates).toHaveBeenCalledWith(1, 20);
      expect(res.items[0].target).toBe(100);
      expect(res.items[0].reward).toEqual({ gold: 1000 });
    });
  });

  describe('createTemplate', () => {
    it('调用 service.createTemplate 并返回 fromEntity 结果', async () => {
      const created = { id: 'a1', name: '新成就', targetValue: 50, rewardJson: { gold: 500 }, condition: 'REACH_LEVEL', conditionJson: {} };
      achievementService.createTemplate.mockResolvedValue(created);
      const res = await ctrl.createTemplate({ name: '新成就', target: 50, reward: { gold: 500 } });
      expect(achievementService.createTemplate).toHaveBeenCalled();
      expect(res.target).toBe(50);
      expect(res.reward).toEqual({ gold: 500 });
    });
  });

  describe('updateTemplate', () => {
    it('调用 service.updateTemplate 并返回 fromEntity 结果', async () => {
      const updated = { id: 'a1', name: '更新后', targetValue: 200, rewardJson: { gold: 2000 }, condition: 'KILL_COUNT', conditionJson: {} };
      achievementService.updateTemplate.mockResolvedValue(updated);
      const res = await ctrl.updateTemplate('a1', { name: '更新后', target: 200 });
      expect(achievementService.updateTemplate).toHaveBeenCalledWith('a1', expect.objectContaining({ targetValue: 200 }));
      expect(res.name).toBe('更新后');
    });
  });
});
