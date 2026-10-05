import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { WorldSceneAdminController } from './world-scene-admin.controller';
import { WorldService } from './world.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';

describe('WorldSceneAdminController', () => {
  let ctrl: WorldSceneAdminController;
  let worldService: any;
  let adminService: any;
  const admin = { adminId: 'a-1' };

  beforeAll(async () => {
    worldService = {
      getScenes: jest.fn(),
      getScene: jest.fn(),
      createScene: jest.fn(),
      updateScene: jest.fn(),
      deleteScene: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [WorldSceneAdminController],
      providers: [
        { provide: WorldService, useValue: worldService },
        { provide: AdminService, useValue: { logOperation: jest.fn().mockResolvedValue(null) } },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        { provide: AdminSessionService, useValue: { validate: jest.fn().mockResolvedValue(true) } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(WorldSceneAdminController);
    adminService = mod.get(AdminService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', WorldSceneAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- listScenes ----------

  it('listScenes 透传过滤条件', async () => {
    const payload = { list: [{ id: 's1' }], total: 1 };
    worldService.getScenes.mockResolvedValue(payload);
    const res = await ctrl.listScenes({ name: 'town', sceneType: 'TOWN', status: 'ACTIVE', page: 1, limit: 20 });
    expect(worldService.getScenes).toHaveBeenCalledWith({ name: 'town', sceneType: 'TOWN', status: 'ACTIVE', page: 1, limit: 20 });
    expect(res).toEqual(payload);
  });

  // ---------- getScene ----------

  it('getScene 透传返回', async () => {
    const scene = { id: 's1', name: 'town' };
    worldService.getScene.mockResolvedValue(scene);
    const res = await ctrl.getScene('s1');
    expect(res).toEqual(scene);
  });

  // ---------- createScene ----------

  it('createScene 透传 + 记操作', async () => {
    const scene: any = { id: 's1', name: 'town', sceneType: 'TOWN', status: 'ACTIVE' };
    worldService.createScene.mockResolvedValue(scene);
    const res = await ctrl.createScene(scene, admin as any);
    expect(worldService.createScene).toHaveBeenCalledWith(scene);
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual(scene);
  });

  // ---------- updateScene ----------

  it('updateScene 读旧值 + 透传更新 + 记操作', async () => {
    const before: any = { id: 's1', name: 'old', sceneType: 'TOWN', mapResKey: 'm1', status: 'ACTIVE', minLevel: 1, maxPlayers: 100 };
    const saved: any = { ...before, name: 'new' };
    worldService.getScene.mockResolvedValue(before);
    worldService.updateScene.mockResolvedValue(saved);
    const res = await ctrl.updateScene('s1', { name: 'new' }, admin as any);
    expect(worldService.updateScene).toHaveBeenCalledWith('s1', { name: 'new' });
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual(saved);
  });

  // ---------- deleteScene ----------

  it('deleteScene 读旧值 + 删除 + 记操作', async () => {
    const before: any = { id: 's1', name: 'town', sceneType: 'TOWN' };
    worldService.getScene.mockResolvedValue(before);
    worldService.deleteScene.mockResolvedValue(undefined);
    const res = await ctrl.deleteScene('s1', admin as any);
    expect(worldService.deleteScene).toHaveBeenCalledWith('s1');
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(res).toEqual({ success: true });
  });
});
