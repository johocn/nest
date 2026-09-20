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
});