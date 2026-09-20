import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LadderService } from './ladder.service';
import { LadderRecord } from './entities';
import { GameEvents } from '@event-bus/game-events';
import { PlayerService } from '@modules/player/player.service';
import { ConfigManageService } from '@modules/config/config.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { AdminService } from '@modules/admin/admin.service';

describe('LadderService', () => {
  let service: LadderService;
  const ladderRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((e) => e),
  };
  const playerService = { getById: jest.fn(), isNewbie: jest.fn() };
  const configService = { getConfig: jest.fn(), setConfig: jest.fn() };
  const eventBus = { emit: jest.fn() };
  const adminService = { logOperation: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.getConfig.mockResolvedValue({ value: '1' });
    const module = await Test.createTestingModule({
      providers: [
        LadderService,
        { provide: getRepositoryToken(LadderRecord), useValue: ladderRepo },
        { provide: PlayerService, useValue: playerService },
        { provide: ConfigManageService, useValue: configService },
        { provide: EventBusService, useValue: eventBus },
        { provide: AdminService, useValue: adminService },
      ],
    }).compile();
    service = module.get(LadderService);
  });

  it('getInfo 无记录时建档 1000 分', async () => {
    ladderRepo.findOne.mockResolvedValue(null);
    ladderRepo.save.mockImplementation((e) => Promise.resolve(e));
    ladderRepo.find.mockResolvedValue([]);
    const info = await service.getInfo('1');
    expect(info.score).toBe(1000);
    expect(info.tier).toBe('青铜');
    expect(info.rank).toBe(0);
  });

  it('settleMatch 非 ranked 模式跳过', async () => {
    await service.settleMatch({ mode: 'casual', players: ['1', '2'] });
    expect(ladderRepo.save).not.toHaveBeenCalled();
  });

  it('settleMatch 更新胜负与段位分', async () => {
    ladderRepo.findOne.mockImplementation(async ({ where }: any) => {
      const id = where.playerId;
      return {
        playerId: id,
        season: '1',
        score: 1000,
        wins: 0,
        losses: 0,
        streak: 0,
      };
    });
    playerService.getById.mockImplementation(async (id: string) => ({
      id,
      level: 10,
      exp: '0',
    }));
    playerService.isNewbie.mockResolvedValue({ protected: false, daysLeft: 0 });
    ladderRepo.save.mockImplementation((rows) => Promise.resolve(rows));
    jest.spyOn(Math, 'random').mockReturnValue(0.9); // 0.9 > 胜率 0.6 → A 负 B 胜
    await service.settleMatch({ mode: 'ranked', players: ['1', '2'] });
    expect(ladderRepo.save).toHaveBeenCalled();
    const saved = ladderRepo.save.mock.calls[0][0] as LadderRecord[];
    const b = saved.find((r) => r.playerId === '2');
    expect(b!.wins).toBe(1);
    expect(b!.score).toBe(1020);
    expect(eventBus.emit).toHaveBeenCalledWith(
      GameEvents.LADDER_MATCH_SETTLED,
      expect.objectContaining({ winnerId: '2' }),
    );
    jest.restoreAllMocks();
  });

  it('settleSeason 结算并开新赛季', async () => {
    ladderRepo.find.mockResolvedValue([
      { playerId: '1', season: '1', score: 1500 } as LadderRecord,
    ]);
    configService.setConfig.mockResolvedValue({});
    const r = await service.settleSeason('a1');
    expect(r.newSeason).toBe('2');
    expect(r.rewarded).toBe(1);
    expect(adminService.logOperation).toHaveBeenCalled();
    expect(configService.setConfig).toHaveBeenCalledWith(
      'ladder.season',
      '2',
      expect.any(String),
      expect.any(String),
      'a1',
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      GameEvents.LADDER_SEASON_SETTLED,
      expect.objectContaining({ season: '1', nextSeason: '2', rewarded: 1 }),
    );
  });
});
