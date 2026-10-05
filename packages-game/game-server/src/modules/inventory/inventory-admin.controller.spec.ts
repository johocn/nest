import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { InventoryAdminController } from './inventory-admin.controller';
import { InventoryService } from './inventory.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('InventoryAdminController', () => {
  let ctrl: InventoryAdminController;
  let inventoryService: any;

  beforeAll(async () => {
    inventoryService = {
      getTemplates: jest.fn(),
      getTemplate: jest.fn(),
      createTemplate: jest.fn(),
      updateTemplate: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [InventoryAdminController],
      providers: [
        { provide: InventoryService, useValue: inventoryService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(InventoryAdminController);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', InventoryAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  it('listTemplates 透传分页参数', async () => {
    const payload = { list: [{ id: 't1' }], total: 1 };
    inventoryService.getTemplates.mockResolvedValue(payload);
    const res = await ctrl.listTemplates({ page: 2, limit: 10 });
    expect(inventoryService.getTemplates).toHaveBeenCalledWith(2, 10);
    expect(res).toEqual(payload);
  });

  it('listTemplates 缺省分页 → page=1, limit=20', async () => {
    inventoryService.getTemplates.mockResolvedValue({ list: [], total: 0 });
    await ctrl.listTemplates({} as any);
    expect(inventoryService.getTemplates).toHaveBeenCalledWith(1, 20);
  });

  it('getTemplate 透传 id', async () => {
    const tpl = { id: 't1', name: 'sword' };
    inventoryService.getTemplate.mockResolvedValue(tpl);
    const res = await ctrl.getTemplate('t1');
    expect(inventoryService.getTemplate).toHaveBeenCalledWith('t1');
    expect(res).toEqual(tpl);
  });

  it('createTemplate 透传 dto', async () => {
    const dto = { name: 'sword', type: 'WEAPON' };
    const created = { id: 't1', ...dto };
    inventoryService.createTemplate.mockResolvedValue(created);
    const res = await ctrl.createTemplate(dto);
    expect(inventoryService.createTemplate).toHaveBeenCalledWith(dto);
    expect(res).toEqual(created);
  });

  it('updateTemplate 透传 id + dto', async () => {
    const dto = { name: 'great sword' };
    const updated = { id: 't1', ...dto };
    inventoryService.updateTemplate.mockResolvedValue(updated);
    const res = await ctrl.updateTemplate('t1', dto);
    expect(inventoryService.updateTemplate).toHaveBeenCalledWith('t1', dto);
    expect(res).toEqual(updated);
  });
});
