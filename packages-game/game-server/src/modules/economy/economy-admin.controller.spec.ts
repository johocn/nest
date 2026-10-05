import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { EconomyAdminController } from './economy-admin.controller';
import { EconomyDashboardService } from './economy-dashboard.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';
import { AdminService } from '@modules/admin/admin.service';
import { Transaction } from './entities/transaction.entity';
import { PlayerCurrency } from '@modules/player/entities/player-currency.entity';
import { RiskRecoverRecord } from '@modules/risk/entities/risk-recover-record.entity';

describe('EconomyAdminController', () => {
  let ctrl: EconomyAdminController;
  const svc = { dashboard: jest.fn() };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [EconomyAdminController],
      providers: [
        { provide: EconomyDashboardService, useValue: svc },
        // EconomyAdminController 扩展后新增的依赖
        { provide: AdminService, useValue: { logOperation: jest.fn().mockResolvedValue(null) } },
        {
          provide: getRepositoryToken(Transaction),
          useValue: { findAndCount: jest.fn(), findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(PlayerCurrency),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(RiskRecoverRecord),
          useValue: { findAndCount: jest.fn(), findOne: jest.fn(), update: jest.fn() },
        },
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
    ctrl = mod.get(EconomyAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('dashboard 返回只读聚合的完整结构', async () => {
    svc.dashboard.mockResolvedValue({
      currencyStats: { totalGold: '100', inflow7d: '50', outflow7d: '20', netChange7d: '30' },
      assetDistribution: { p50: '1', p90: '90', max: '100', activeCount: 3 },
      frozenAmount: '10',
      recoveryToDate: '5',
    });
    const res = await ctrl.dashboard();
    expect(svc.dashboard).toHaveBeenCalled();
    expect(res).toEqual({
      currencyStats: { totalGold: '100', inflow7d: '50', outflow7d: '20', netChange7d: '30' },
      assetDistribution: { p50: '1', p90: '90', max: '100', activeCount: 3 },
      frozenAmount: '10',
      recoveryToDate: '5',
    });
  });

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', EconomyAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });
});