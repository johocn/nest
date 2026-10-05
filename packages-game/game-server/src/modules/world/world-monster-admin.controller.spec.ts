import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { WorldMonsterAdminController } from './world-monster-admin.controller';
import { WorldService } from './world.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';

describe('WorldMonsterAdminController', () => {
  let ctrl: WorldMonsterAdminController;
  let worldService: any;
  let adminService: any;
  const admin = { adminId: 'a-1' };

  beforeAll(async () => {
    worldService = {
      getMonsterTemplates: jest.fn(),
      getMonsterTemplate: jest.fn(),
      createMonsterTemplate: jest.fn(),
      updateMonsterTemplate: jest.fn(),
      deleteMonsterTemplate: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [WorldMonsterAdminController],
      providers: [
        { provide: WorldService, useValue: worldService },
        { provide: AdminService, useValue: { logOperation: jest.fn().mockResolvedValue(null) } },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        { provide: AdminSessionService, useValue: { validate: jest.fn().mockResolvedValue(true) } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(WorldMonsterAdminController);
    adminService = mod.get(AdminService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', WorldMonsterAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- listMonsters ----------

  it('listMonsters 透传过滤条件', async () => {
    const payload = { list: [{ id: 'm1' }], total: 1 };
    worldService.getMonsterTemplates.mockResolvedValue(payload);
    const res = await ctrl.listMonsters({ name: 'slime', aiType: 'Agressive', page: 1, limit: 20 });
    expect(worldService.getMonsterTemplates).toHaveBeenCalledWith({ name: 'slime', aiType: 'Agressive', page: 1, limit: 20 });
    expect(res).toEqual(payload);
  });

  // ---------- getMonster ----------

  it('getMonster 透传返回', async () => {
    const monster = { id: 'm1', name: 'slime' };
    worldService.getMonsterTemplate.mockResolvedValue(monster);
    const res = await ctrl.getMonster('m1');
    expect(res).toEqual(monster);
  });

  // ---------- createMonster ----------

  it('createMonster 透传 + 记操作', async () => {
    const monster: any = { id: 'm1', name: 'slime', aiType: 'Agressive', baseHp: 100, baseAtk: 10 };
    worldService.createMonsterTemplate.mockResolvedValue(monster);
    const res = await ctrl.createMonster(monster, admin as any);
    expect(worldService.createMonsterTemplate).toHaveBeenCalledWith(monster);
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual(monster);
  });

  // ---------- updateMonster ----------

  it('updateMonster 读旧值 + 透传更新 + 记操作', async () => {
    const before: any = { id: 'm1', name: 'slime', aiType: 'Agressive', baseHp: 100, baseAtk: 10, aggroRange: 5, refreshCd: 30 };
    const saved: any = { ...before, name: 'big slime', baseHp: 500 };
    worldService.getMonsterTemplate.mockResolvedValue(before);
    worldService.updateMonsterTemplate.mockResolvedValue(saved);
    const res = await ctrl.updateMonster('m1', { name: 'big slime', baseHp: 500 }, admin as any);
    expect(worldService.updateMonsterTemplate).toHaveBeenCalledWith('m1', { name: 'big slime', baseHp: 500 });
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual(saved);
  });

  // ---------- deleteMonster ----------

  it('deleteMonster 读旧值 + 删除 + 记操作', async () => {
    const before: any = { id: 'm1', name: 'slime', aiType: 'Agressive' };
    worldService.getMonsterTemplate.mockResolvedValue(before);
    worldService.deleteMonsterTemplate.mockResolvedValue(undefined);
    const res = await ctrl.deleteMonster('m1', admin as any);
    expect(worldService.deleteMonsterTemplate).toHaveBeenCalledWith('m1');
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual({ success: true });
  });
});
