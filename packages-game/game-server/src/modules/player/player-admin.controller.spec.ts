import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as ReflectMetadata from 'reflect-metadata';
import { PlayerAdminController } from './player-admin.controller';
import { PlayerService } from './player.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('PlayerAdminController', () => {
  let ctrl: PlayerAdminController;
  let playerService: any;

  beforeAll(async () => {
    playerService = {
      findPaginated: jest.fn(),
      getBaseInfo: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [PlayerAdminController],
      providers: [
        { provide: PlayerService, useValue: playerService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(PlayerAdminController);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', PlayerAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  it('list 透传分页参数', async () => {
    const payload = { list: [{ id: 'p1' }], total: 1 };
    playerService.findPaginated.mockResolvedValue(payload);
    const res = await ctrl.list({ page: 2, limit: 10 });
    expect(playerService.findPaginated).toHaveBeenCalledWith(2, 10);
    expect(res).toEqual(payload);
  });

  it('list 缺省分页 → page=1, limit=20', async () => {
    playerService.findPaginated.mockResolvedValue({ list: [], total: 0 });
    await ctrl.list({} as any);
    expect(playerService.findPaginated).toHaveBeenCalledWith(1, 20);
  });

  it('detail 透传 id', async () => {
    const detail = { id: 'p1', name: 'hero' };
    playerService.getBaseInfo.mockResolvedValue(detail);
    const res = await ctrl.detail('p1');
    expect(playerService.getBaseInfo).toHaveBeenCalledWith('p1');
    expect(res).toEqual(detail);
  });
});
