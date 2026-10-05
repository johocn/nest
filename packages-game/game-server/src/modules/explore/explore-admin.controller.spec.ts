import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { ExploreAdminController } from './explore-admin.controller';
import { ExploreService } from './explore.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('ExploreAdminController', () => {
  let ctrl: ExploreAdminController;
  let exploreService: any;

  beforeAll(async () => {
    exploreService = {
      listTemplates: jest.fn(),
      createTemplate: jest.fn(),
      updateTemplate: jest.fn(),
      removeTemplate: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [ExploreAdminController],
      providers: [
        { provide: ExploreService, useValue: exploreService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(ExploreAdminController);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', ExploreAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  it('listTemplates 返回 { list } 包装', async () => {
    const list = [{ id: 'e1', name: '偶遇' }];
    exploreService.listTemplates.mockResolvedValue(list);
    const res = await ctrl.listTemplates();
    expect(exploreService.listTemplates).toHaveBeenCalled();
    expect(res).toEqual({ list });
  });

  it('createTemplate 透传 dto', async () => {
    const dto = { name: '偶遇', type: 'BATTLE' };
    const created = { id: 'e1', ...dto };
    exploreService.createTemplate.mockResolvedValue(created);
    const res = await ctrl.createTemplate(dto);
    expect(exploreService.createTemplate).toHaveBeenCalledWith(dto);
    expect(res).toEqual(created);
  });

  it('updateTemplate 透传 id + dto', async () => {
    const dto = { name: '奇遇' };
    const updated = { id: 'e1', ...dto };
    exploreService.updateTemplate.mockResolvedValue(updated);
    const res = await ctrl.updateTemplate('e1', dto);
    expect(exploreService.updateTemplate).toHaveBeenCalledWith('e1', dto);
    expect(res).toEqual(updated);
  });

  it('removeTemplate 返回 { removed: id }', async () => {
    exploreService.removeTemplate.mockResolvedValue(undefined);
    const res = await ctrl.removeTemplate('e1');
    expect(exploreService.removeTemplate).toHaveBeenCalledWith('e1');
    expect(res).toEqual({ removed: 'e1' });
  });
});
