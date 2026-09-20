import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RiskIdentityService } from './risk-identity.service';
import { RiskIdentityLink } from './entities';
import { AccountLoginLog } from '@modules/auth/entities/account-login-log.entity';
import { AuthAccount } from '@modules/auth/entities/auth-account.entity';
import { Player } from '@modules/player/entities/player.entity';
import { ConfigManageService } from '@modules/config/config.service';

describe('RiskIdentityService', () => {
  let service: RiskIdentityService;
  const sink: any[] = [];
  const linkRepo = {
    find: jest.fn(),
    save: jest.fn((x: any) => x),
    create: jest.fn((x: any) => x),
    upsert: jest.fn().mockResolvedValue({}),
  };
  const loginLogRepo = { find: jest.fn().mockResolvedValue([]) };
  const accountRepo = { find: jest.fn().mockResolvedValue([]) };
  const playerRepo = { find: jest.fn().mockResolvedValue([]) };
  const config = { getConfig: jest.fn().mockResolvedValue(null) };

  beforeEach(async () => {
    jest.clearAllMocks();
    sink.length = 0;
    // 模拟真实表：find 返回已保存的行，save 落表 → 幂等去重可被观测
    linkRepo.find.mockImplementation(() => Promise.resolve([...sink]));
    linkRepo.save.mockImplementation((x: any) => { sink.push(x); return x; });
    const mod = await Test.createTestingModule({
      providers: [
        RiskIdentityService,
        { provide: getRepositoryToken(RiskIdentityLink), useValue: linkRepo },
        { provide: getRepositoryToken(AccountLoginLog), useValue: loginLogRepo },
        { provide: getRepositoryToken(AuthAccount), useValue: accountRepo },
        { provide: getRepositoryToken(Player), useValue: playerRepo },
        { provide: ConfigManageService, useValue: config },
      ],
    }).compile();
    service = mod.get(RiskIdentityService);
  });

  const seedPlayers = (m: Record<string, string>) => {
    playerRepo.find.mockResolvedValue(Object.entries(m).map(([accountId, id]) => ({ id, accountId })));
  };

  it('窗口内同 IP 的两玩家写出 SAME_IP 邻接（a<b 字典序）', async () => {
    loginLogRepo.find.mockResolvedValue([
      { accountId: 'accP1', loginIp: '1.2.3.4', deviceInfo: 'devX' },
      { accountId: 'accP2', loginIp: '1.2.3.4', deviceInfo: 'devY' },
    ]);
    seedPlayers({ accP1: 'P1', accP2: 'P2' });
    await service.buildGraph({ windowMin: 10 } as any);
    expect(linkRepo.save).toHaveBeenCalled();
    const saved = linkRepo.save.mock.calls.flat();
    expect(saved.some((e: RiskIdentityLink) => e.playerIdA === 'P1' && e.playerIdB === 'P2' && e.linkType === 'same_ip')).toBe(true);
  });

  it('窗口内同 device 的两玩家写出 SAME_DEVICE 邻接', async () => {
    loginLogRepo.find.mockResolvedValue([
      { accountId: 'accP1', loginIp: '1.1.1.1', deviceInfo: 'devZ' },
      { accountId: 'accP2', loginIp: '2.2.2.2', deviceInfo: 'devZ' },
    ]);
    seedPlayers({ accP1: 'P1', accP2: 'P2' });
    await service.buildGraph({ windowMin: 10 } as any);
    const saved = linkRepo.save.mock.calls.flat();
    expect(saved.some((e: RiskIdentityLink) => e.playerIdA === 'P1' && e.playerIdB === 'P2' && e.linkType === 'same_device')).toBe(true);
  });

  it('SSO 同源的两账号写出 SSO 邻接', async () => {
    accountRepo.find.mockResolvedValue([
      { id: 'accP1', ssoId: 'sso-1', ssoProvider: 'google' },
      { id: 'accP2', ssoId: 'sso-1', ssoProvider: 'google' },
    ]);
    seedPlayers({ accP1: 'P1', accP2: 'P2' });
    await service.buildGraph({ windowMin: 10 } as any);
    const saved = linkRepo.save.mock.calls.flat();
    expect(saved.some((e: RiskIdentityLink) => e.playerIdA === 'P1' && e.playerIdB === 'P2' && e.linkType === 'sso')).toBe(true);
  });

  it('重复构建幂等：邻接去重，重复跑不增行', async () => {
    loginLogRepo.find.mockResolvedValue([
      { accountId: 'accP1', loginIp: '9.9.9.9', deviceInfo: 'devD' },
      { accountId: 'accP2', loginIp: '9.9.9.9', deviceInfo: 'devD' },
    ]);
    seedPlayers({ accP1: 'P1', accP2: 'P2' });
    await service.buildGraph({ windowMin: 10 } as any);
    await service.buildGraph({ windowMin: 10 } as any);
    const saved = linkRepo.save.mock.calls.flat();
    const keys = saved.map((e: any) => `${e.playerIdA}|${e.playerIdB}|${e.linkType}`);
    expect(new Set(keys).size).toBe(keys.length); // 无重复行
  });
});