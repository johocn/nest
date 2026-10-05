import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { WorldBuildingAdminController } from './world-building-admin.controller';
import { BuildingAdminService } from './building/building-admin.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';

describe('WorldBuildingAdminController', () => {
  let ctrl: WorldBuildingAdminController;
  let buildingAdminService: any;
  let adminService: any;
  const admin = { adminId: 'a-1' };

  beforeAll(async () => {
    buildingAdminService = {
      listTemplates: jest.fn(),
      getTemplate: jest.fn(),
      createTemplate: jest.fn(),
      updateTemplate: jest.fn(),
      toggleTemplate: jest.fn(),
      deleteTemplate: jest.fn(),
      upsertRule: jest.fn(),
      listInstances: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [WorldBuildingAdminController],
      providers: [
        { provide: BuildingAdminService, useValue: buildingAdminService },
        { provide: AdminService, useValue: { logOperation: jest.fn().mockResolvedValue(null) } },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        { provide: AdminSessionService, useValue: { validate: jest.fn().mockResolvedValue(true) } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(WorldBuildingAdminController);
    adminService = mod.get(AdminService);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', WorldBuildingAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  // ---------- BuildingTemplate ----------

  it('listBuildingTemplates 过滤 category / isActive（支持 "true"/"false"）', async () => {
    const payload = { list: [{ id: 'bt1', category: 'HOUSE', isActive: true }], total: 1 };
    buildingAdminService.listTemplates.mockResolvedValue(payload);

    // category 透传
    let res = await ctrl.listBuildingTemplates('HOUSE', undefined);
    expect(buildingAdminService.listTemplates).toHaveBeenCalledWith({ category: 'HOUSE', isActive: undefined });
    expect(res).toEqual(payload);

    // isActive="true" → 布尔 true
    res = await ctrl.listBuildingTemplates(undefined, 'true');
    expect(buildingAdminService.listTemplates).toHaveBeenLastCalledWith({ category: undefined, isActive: true });

    // isActive="false" → 布尔 false
    res = await ctrl.listBuildingTemplates(undefined, 'false');
    expect(buildingAdminService.listTemplates).toHaveBeenLastCalledWith({ category: undefined, isActive: false });
  });

  it('getBuildingTemplate 透传', async () => {
    const tpl = { id: 'bt1', name: 'cottage' };
    buildingAdminService.getTemplate.mockResolvedValue(tpl);
    const res = await ctrl.getBuildingTemplate('bt1');
    expect(buildingAdminService.getTemplate).toHaveBeenCalledWith('bt1');
    expect(res).toEqual(tpl);
  });

  it('createBuildingTemplate 透传', async () => {
    const dto: any = { name: 'cottage', category: 'HOUSE' };
    const created = { id: 'bt1', ...dto };
    buildingAdminService.createTemplate.mockResolvedValue(created);
    const res = await ctrl.createBuildingTemplate(dto);
    expect(buildingAdminService.createTemplate).toHaveBeenCalledWith(dto);
    expect(res).toEqual(created);
  });

  it('updateBuildingTemplate 透传', async () => {
    const dto: any = { name: 'villa' };
    const updated = { id: 'bt1', name: 'villa' };
    buildingAdminService.updateTemplate.mockResolvedValue(updated);
    const res = await ctrl.updateBuildingTemplate('bt1', dto);
    expect(buildingAdminService.updateTemplate).toHaveBeenCalledWith('bt1', dto);
    expect(res).toEqual(updated);
  });

  it('toggleBuildingTemplate 透传 isActive', async () => {
    const toggled = { id: 'bt1', isActive: false };
    buildingAdminService.toggleTemplate.mockResolvedValue(toggled);
    const res = await ctrl.toggleBuildingTemplate('bt1', { isActive: false });
    expect(buildingAdminService.toggleTemplate).toHaveBeenCalledWith('bt1', false);
    expect(res).toEqual(toggled);
  });

  it('deleteBuildingTemplate 读旧值 + 删除 + 记操作', async () => {
    const before: any = { id: 'bt1', name: 'cottage', category: 'HOUSE' };
    buildingAdminService.getTemplate.mockResolvedValue(before);
    buildingAdminService.deleteTemplate.mockResolvedValue(undefined);
    await ctrl.deleteBuildingTemplate('bt1', admin as any);
    expect(buildingAdminService.deleteTemplate).toHaveBeenCalledWith('bt1');
    expect(adminService.logOperation).toHaveBeenCalled();
  });

  // ---------- BuildRule ----------

  it('upsertBuildRule 透传', async () => {
    const dto: any = { maxBuildings: 10 };
    const saved = { sceneId: 's1', ...dto };
    buildingAdminService.upsertRule.mockResolvedValue(saved);
    const res = await ctrl.upsertBuildRule('s1', dto);
    expect(buildingAdminService.upsertRule).toHaveBeenCalledWith('s1', dto);
    expect(res).toEqual(saved);
  });

  // ---------- BuildingInstance ----------

  it('listBuildings 过滤 sceneId / playerId / state', async () => {
    const payload = { list: [{ id: 'bi1' }], total: 1 };
    buildingAdminService.listInstances.mockResolvedValue(payload);
    const res = await ctrl.listBuildings('s1', 'p1', 'BUILDING');
    expect(buildingAdminService.listInstances).toHaveBeenCalledWith({
      sceneId: 's1',
      playerId: 'p1',
      state: 'BUILDING',
    });
    expect(res).toEqual(payload);
  });
});
