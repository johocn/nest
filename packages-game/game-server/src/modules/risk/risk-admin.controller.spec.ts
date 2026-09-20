import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RiskAdminController } from './risk-admin.controller';
import { RiskWashService } from './risk-wash.service';

describe('RiskAdminController', () => {
  let ctrl: RiskAdminController;
  const svc = {
    listCases: jest.fn().mockResolvedValue([]),
    playerScore: jest.fn(),
    disposeCase: jest.fn(),
    addWhitelist: jest.fn(),
    removeWhitelist: jest.fn(),
    openCasesFor: jest.fn(),
    dashboard: jest.fn(),
    recoverProposal: jest.fn(),
    recover: jest.fn(),
    rollback: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [RiskAdminController],
      providers: [
        { provide: RiskWashService, useValue: svc },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(RiskAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('dispose 携带管理员用户名处置', async () => {
    await ctrl.dispose('5', { action: 'frozen' as any }, { username: 'GM1' } as any);
    expect(svc.disposeCase).toHaveBeenCalledWith('5', 'frozen', 'GM1', undefined);
  });

  it('white 名单增删调用服务', async () => {
    await ctrl.addWhitelist({ playerId: 'A', note: 'n' } as any, { username: 'GM1' } as any);
    expect(svc.addWhitelist).toHaveBeenCalledWith('A', 'n', 'GM1');
    await ctrl.removeWhitelist('A');
    expect(svc.removeWhitelist).toHaveBeenCalledWith('A');
  });

  it('dashboard 调用服务', async () => {
    svc.dashboard.mockResolvedValue({ top: [{ playerId: 'p1', riskScore: 90, level: 'high' }], pending: 3 });
    const res = await ctrl.dashboard();
    expect(svc.dashboard).toHaveBeenCalled();
    expect(res.top).toHaveLength(1);
  });

  it('recover-proposal 携带 caseId', async () => {
    svc.recoverProposal.mockResolvedValue({ suggestedAmount: '1500' });
    await ctrl.recoverProposal('c1');
    expect(svc.recoverProposal).toHaveBeenCalledWith('c1');
  });

  it('recover 携带管理员与备注', async () => {
    svc.recover.mockResolvedValue({ id: 'r1', status: 'applied' });
    await ctrl.recover('c1', { note: '洗分超额' } as any, { username: 'GM1' } as any);
    expect(svc.recover).toHaveBeenCalledWith('c1', 'GM1', '洗分超额');
  });

  it('rollback 携带管理员与原因', async () => {
    svc.rollback.mockResolvedValue({ id: 'r1', status: 'rolled_back' });
    await ctrl.rollback('r1', { reason: '误判' } as any, { username: 'GM1' } as any);
    expect(svc.rollback).toHaveBeenCalledWith('r1', 'GM1', '误判');
  });
});