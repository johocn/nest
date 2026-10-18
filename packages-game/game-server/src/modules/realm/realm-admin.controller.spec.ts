import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { RealmAdminController } from './realm-admin.controller';
import { RealmService } from './realm.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('RealmAdminController', () => {
  let ctrl: RealmAdminController;
  let realmService: any;

  beforeAll(async () => {
    realmService = {
      listTemplates: jest.fn(),
      createTemplate: jest.fn(),
      updateTemplate: jest.fn(),
      removeTemplate: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [RealmAdminController],
      providers: [
        { provide: RealmService, useValue: realmService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(RealmAdminController);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', RealmAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  it('listTemplates 返回 { list } 包装', async () => {
    const list = [{ id: 'r1', name: '炼气' }];
    realmService.listTemplates.mockResolvedValue(list);
    const res = await ctrl.listTemplates();
    expect(realmService.listTemplates).toHaveBeenCalled();
    expect(res).toEqual({ list });
  });

  it('createTemplate 透传 dto', async () => {
    const dto = { name: '炼气', level: 1 };
    const created = { id: 'r1', ...dto };
    realmService.createTemplate.mockResolvedValue(created);
    const res = await ctrl.createTemplate(dto);
    expect(realmService.createTemplate).toHaveBeenCalledWith(dto);
    expect(res).toEqual(created);
  });

  it('updateTemplate 透传 id + dto', async () => {
    const dto = { name: '筑基' };
    const updated = { id: 'r1', ...dto };
    realmService.updateTemplate.mockResolvedValue(updated);
    const res = await ctrl.updateTemplate('r1', dto);
    expect(realmService.updateTemplate).toHaveBeenCalledWith('r1', dto);
    expect(res).toEqual(updated);
  });

  it('removeTemplate 返回 { removed: id }', async () => {
    realmService.removeTemplate.mockResolvedValue(undefined);
    const res = await ctrl.removeTemplate('r1');
    expect(realmService.removeTemplate).toHaveBeenCalledWith('r1');
    expect(res).toEqual({ removed: 'r1' });
  });
});
