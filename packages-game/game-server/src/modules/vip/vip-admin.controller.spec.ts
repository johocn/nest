import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { VipAdminController } from './vip-admin.controller';
import { VipService } from './vip.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('VipAdminController', () => {
  let ctrl: VipAdminController;
  const vipService = {
    getConfigList: jest.fn(),
    createConfig: jest.fn(),
    updateConfig: jest.fn(),
    deleteConfig: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [VipAdminController],
      providers: [
        { provide: VipService, useValue: vipService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(VipAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', VipAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  describe('listConfigs', () => {
    it('调用 service.getConfigList 并返回 fromEntity 映射后的 benefits', async () => {
      const raw = [
        { level: 1, name: 'VIP1', requiredExp: 1000, privilegeJson: { extraBag: 5 } },
        { level: 2, name: 'VIP2', requiredExp: 5000, privilegeJson: { extraBag: 10 } },
      ];
      vipService.getConfigList.mockResolvedValue(raw);
      const res = await ctrl.listConfigs();
      expect(vipService.getConfigList).toHaveBeenCalled();
      expect(res).toHaveLength(2);
      expect(res[0].benefits).toEqual({ extraBag: 5 });
      expect(res[1].benefits).toEqual({ extraBag: 10 });
    });
  });

  describe('createConfig', () => {
    it('调用 service.createConfig 并返回 fromEntity 结果', async () => {
      const created = { level: 3, name: 'VIP3', requiredExp: 10000, privilegeJson: { extraBag: 20, dailyGold: 100 } };
      vipService.createConfig.mockResolvedValue(created);
      const res = await ctrl.createConfig({ level: 3, name: 'VIP3', benefits: { extraBag: 20, dailyGold: 100 } });
      expect(vipService.createConfig).toHaveBeenCalledWith(
        expect.objectContaining({ privilegeJson: { extraBag: 20, dailyGold: 100 } }),
      );
      expect(res.benefits).toEqual({ extraBag: 20, dailyGold: 100 });
    });
  });

  describe('updateConfig', () => {
    it('调用 service.updateConfig 时 level 被转成 number', async () => {
      const updated = { level: 1, name: 'VIP1-renamed', requiredExp: 500, privilegeJson: { extraBag: 8 } };
      vipService.updateConfig.mockResolvedValue(updated);
      const res = await ctrl.updateConfig('1', { name: 'VIP1-renamed', benefits: { extraBag: 8 } });
      expect(vipService.updateConfig).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ name: 'VIP1-renamed' }),
      );
      expect(res.level).toBe(1);
    });
  });

  describe('deleteConfig', () => {
    it('调用 service.deleteConfig 时 level 被转成 number', async () => {
      vipService.deleteConfig.mockResolvedValue({ ok: true });
      const res = await ctrl.deleteConfig('1');
      expect(vipService.deleteConfig).toHaveBeenCalledWith(1);
      expect(res).toEqual({ ok: true });
    });
  });
});
