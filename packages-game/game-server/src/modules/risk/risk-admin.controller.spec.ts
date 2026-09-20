import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RiskAdminController } from './risk-admin.controller';
import { RiskWashService } from './risk-wash.service';
import { RiskReplayService } from './risk-replay.service';
import { RiskIdentityService } from './risk-identity.service';
import { AdminService } from '@modules/admin/admin.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

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
    lock: jest.fn(),
  };
  const replayService = {
    replay: jest.fn().mockResolvedValue({ iterated: 0, hitCount: 0, hitAccounts: [], scoreBuckets: { normal: 0, watch: 0, high: 0 } }),
  };
  const adminService = {
    logOperation: jest.fn().mockResolvedValue({}),
  };
  const identityService = {
    graphOf: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [RiskAdminController],
      providers: [
        { provide: RiskWashService, useValue: svc },
        { provide: RiskReplayService, useValue: replayService },
        { provide: AdminService, useValue: adminService },
        { provide: RiskIdentityService, useValue: identityService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
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

  it('lock 携带管理员、惩罚等级与原因', async () => {
    svc.lock.mockResolvedValue({ caseId: 'c1', applied: [{ playerId: 'p1', level: 'ban', appliedAt: new Date() }] });
    await ctrl.lock('c1', { level: 'ban', reason: '风控封禁' } as any, { username: 'GM1', adminId: 100 } as any);
    expect(svc.lock).toHaveBeenCalledWith('c1', 100, 'GM1', 'ban', '风控封禁');
  });

  it('replay 合法参数调用回放服务并留 gm-log', async () => {
    replayService.replay.mockResolvedValue({
      iterated: 5, hitCount: 1,
      hitAccounts: [{ playerId: 'A', score: 60, level: 'watch', signals: [] }],
      scoreBuckets: { normal: 0, watch: 1, high: 0 },
    });
    const res = await ctrl.replay(
      { since: new Date('2026-01-01T00:00:00Z'), until: new Date('2026-01-02T00:00:00Z'), configOverrides: { 'risk.high_score': 50 } } as any,
      { username: 'GM1', adminId: 100 } as any,
    );
    expect(replayService.replay).toHaveBeenCalled();
    expect(adminService.logOperation).toHaveBeenCalledWith(expect.objectContaining({ operation: 'risk.replay', adminId: 100 }));
    expect(res.hitCount).toBe(1);
  });

  it('replay 非法 override 键抛 92901 且不触达回放服务', async () => {
    await expect(
      ctrl.replay(
        { since: new Date('2026-01-01T00:00:00Z'), until: new Date('2026-01-02T00:00:00Z'), configOverrides: { bogus: 1 } } as any,
        { username: 'GM1' } as any,
      ),
    ).rejects.toMatchObject({ response: { code: 92901 } });
    expect(replayService.replay).not.toHaveBeenCalled();
  });

  it('identity/player/:playerId 返回身份图谱（只读）', async () => {
    identityService.graphOf.mockResolvedValue({
      playerId: 'P1',
      clusterSize: 2,
      links: [{ peerId: 'P2', linkType: 'same_device', confidence: 0.95 }],
    });
    const res = await ctrl.identityGraph('P1');
    expect(identityService.graphOf).toHaveBeenCalledWith('P1');
    expect(res).toEqual({
      playerId: 'P1',
      clusterSize: 2,
      links: [{ peerId: 'P2', linkType: 'same_device', confidence: 0.95 }],
    });
  });
});