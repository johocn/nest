import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { SocialAdminController } from './social-admin.controller';
import { SocialEconomyService } from './social-economy.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('SocialAdminController', () => {
  let ctrl: SocialAdminController;
  let socialSvc: { adminAdjustPoints: jest.Mock };

  beforeAll(async () => {
    socialSvc = { adminAdjustPoints: jest.fn() };

    const mod = await Test.createTestingModule({
      controllers: [SocialAdminController],
      providers: [
        { provide: SocialEconomyService, useValue: socialSvc },
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
    ctrl = mod.get(SocialAdminController);
  });

  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', SocialAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  it('adjustPoints 返回 { playerId, balance }', async () => {
    socialSvc.adminAdjustPoints.mockResolvedValue(50);
    const res = await ctrl.adjustPoints(
      'p-123',
      { delta: 10, note: '补发' } as any,
      { adminId: 1, username: 'gm' } as any,
    );
    expect(res).toEqual({ playerId: 'p-123', balance: 50 });
    expect(socialSvc.adminAdjustPoints).toHaveBeenCalledWith(
      'p-123',
      10,
      'gm',
      '补发',
    );
  });
});
