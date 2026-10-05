import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { NpcAdminController } from './npc-admin.controller';
import { NpcSpawnRule } from './entities/npc-spawn-rule.entity';
import { NpcPatrolRoute } from './entities/npc-patrol-route.entity';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';

describe('NpcAdminController', () => {
  let ctrl: NpcAdminController;
  let ruleRepo: any;
  let routeRepo: any;
  let adminService: any;
  const admin = { adminId: 'a-1' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [NpcAdminController],
      providers: [
        {
          provide: getRepositoryToken(NpcSpawnRule),
          useValue: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() },
        },
        {
          provide: getRepositoryToken(NpcPatrolRoute),
          useValue: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() },
        },
        { provide: AdminService, useValue: { logOperation: jest.fn().mockResolvedValue(null) } },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        { provide: AdminSessionService, useValue: { validate: jest.fn().mockResolvedValue(true) } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(NpcAdminController);
    ruleRepo = mod.get(getRepositoryToken(NpcSpawnRule));
    routeRepo = mod.get(getRepositoryToken(NpcPatrolRoute));
    adminService = mod.get(AdminService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', NpcAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- NPC 出现规则 ----------

  it('listRules 返回 { list } 包装', async () => {
    const list = [{ id: 'r1', sceneId: 's1' }];
    ruleRepo.find.mockResolvedValue(list);
    const res = await ctrl.listRules({ sceneId: 's1' } as any);
    expect(ruleRepo.find).toHaveBeenCalled();
    expect(res).toEqual({ list });
  });

  it('createRule 保存 + 记操作日志', async () => {
    const dto = { sceneId: 's1', npcTemplateId: 'n1', ruleType: 'FIXED', name: 'guard' };
    const created = { id: 'r1', ...dto, isActive: true, patrolRouteId: null };
    ruleRepo.create.mockReturnValue({ ...dto, isActive: true, patrolRouteId: null });
    ruleRepo.save.mockResolvedValue(created);
    const res = await ctrl.createRule(dto as any, admin as any);
    expect(ruleRepo.save).toHaveBeenCalled();
    expect(adminService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'a-1',
        operation: 'npc-rule.create',
      }),
    );
    expect(res).toEqual(created);
  });

  it('updateRule 找不到抛错', async () => {
    ruleRepo.findOne.mockResolvedValue(null);
    await expect(ctrl.updateRule('missing', {}, admin as any)).rejects.toThrow();
  });

  it('updateRule 找到后保存 + 记操作日志', async () => {
    const existing: any = {
      id: 'r1', sceneId: 's1', ruleType: 'FIXED', name: 'guard',
      spawnX: 0, spawnY: 0, spawnRadius: 0, spawnCount: 1,
      condition: null, patrolRouteId: null, isActive: true,
    };
    ruleRepo.findOne.mockResolvedValue(existing);
    ruleRepo.save.mockImplementation(async (x: any) => x);
    const res = await ctrl.updateRule('r1', { name: 'guard2' } as any, admin as any);
    expect(res.name).toBe('guard2');
    expect(adminService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'npc-rule.update' }),
    );
  });

  it('removeRule 找到后软删 + 记操作日志', async () => {
    const existing: any = { id: 'r1', sceneId: 's1', ruleType: 'FIXED', name: 'guard' };
    ruleRepo.findOne.mockResolvedValue(existing);
    ruleRepo.softRemove.mockResolvedValue(existing);
    const res = await ctrl.removeRule('r1', admin as any);
    expect(ruleRepo.softRemove).toHaveBeenCalled();
    expect(adminService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'npc-rule.delete' }),
    );
    expect(res).toEqual({ success: true });
  });

  it('toggleRule 找不到抛错', async () => {
    ruleRepo.findOne.mockResolvedValue(null);
    await expect(ctrl.toggleRule('missing', {})).rejects.toThrow();
  });

  it('toggleRule 显式设为 false', async () => {
    const existing: any = { id: 'r1', isActive: true };
    ruleRepo.findOne.mockResolvedValue(existing);
    ruleRepo.save.mockImplementation(async (x: any) => x);
    const res = await ctrl.toggleRule('r1', { isActive: false });
    expect(res.isActive).toBe(false);
  });

  it('toggleRule 未传 isActive → 取反', async () => {
    const existing: any = { id: 'r1', isActive: true };
    ruleRepo.findOne.mockResolvedValue(existing);
    ruleRepo.save.mockImplementation(async (x: any) => x);
    const res = await ctrl.toggleRule('r1', {});
    expect(res.isActive).toBe(false);
  });

  // ---------- NPC 巡逻路径 ----------

  it('listRoutes 返回 { list } 包装', async () => {
    const list = [{ id: 'rt1', sceneId: 's1' }];
    routeRepo.find.mockResolvedValue(list);
    const res = await ctrl.listRoutes({ sceneId: 's1' } as any);
    expect(routeRepo.find).toHaveBeenCalled();
    expect(res).toEqual({ list });
  });

  it('createRoute 保存 + 记操作日志', async () => {
    const dto = { sceneId: 's1', npcTemplateId: 'n1', name: 'patrol-a', points: [{ x: 0, y: 0 }] };
    const created = { id: 'rt1', ...dto, loopMode: undefined, speed: undefined, isActive: true };
    routeRepo.create.mockReturnValue({ ...dto, loopMode: undefined, speed: undefined, isActive: true });
    routeRepo.save.mockResolvedValue(created);
    const res = await ctrl.createRoute(dto as any, admin as any);
    expect(routeRepo.save).toHaveBeenCalled();
    expect(adminService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'a-1',
        operation: 'npc-route.create',
      }),
    );
    expect(res).toEqual(created);
  });

  it('updateRoute 找到后保存 + 记操作日志', async () => {
    const existing: any = {
      id: 'rt1', npcTemplateId: 'n1', name: 'patrol-a',
      loopMode: null, speed: null, points: [], isActive: true,
    };
    routeRepo.findOne.mockResolvedValue(existing);
    routeRepo.save.mockImplementation(async (x: any) => x);
    const res = await ctrl.updateRoute('rt1', { name: 'patrol-b' } as any, admin as any);
    expect(res.name).toBe('patrol-b');
    expect(adminService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'npc-route.update' }),
    );
  });

  it('removeRoute 找到后软删 + 记操作日志', async () => {
    const existing: any = { id: 'rt1', sceneId: 's1', name: 'patrol-a' };
    routeRepo.findOne.mockResolvedValue(existing);
    routeRepo.softRemove.mockResolvedValue(existing);
    const res = await ctrl.removeRoute('rt1', admin as any);
    expect(routeRepo.softRemove).toHaveBeenCalled();
    expect(adminService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'npc-route.delete' }),
    );
    expect(res).toEqual({ success: true });
  });
});
