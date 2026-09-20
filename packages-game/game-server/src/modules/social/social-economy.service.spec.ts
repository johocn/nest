import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SocialEconomyService } from './social-economy.service';
import { SocialPointRecord, SocialChest } from './entities';
import {
  SocialPointType,
  SocialPointReason,
  SocialChestType,
  SocialChestStatus,
} from '@constants/enums';
import { GameEvents } from '@event-bus/game-events';
import { ConfigManageService } from '@modules/config/config.service';
import { EventBusService } from '@event-bus/event-bus.service';

describe('SocialEconomyService', () => {
  let service: SocialEconomyService;
  const pointRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((e) => e),
    find: jest.fn(),
    findAndCount: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const chestRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((e) => e),
  };
  const configService = { getConfig: jest.fn() };
  const eventBus = { emit: jest.fn() };

  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    pointRepo.createQueryBuilder.mockReturnValue(qb);
    qb.getRawOne.mockResolvedValue({ total: '0' });
    pointRepo.save.mockResolvedValue({ balanceAfter: 0 });
    const module = await Test.createTestingModule({
      providers: [
        SocialEconomyService,
        { provide: getRepositoryToken(SocialPointRecord), useValue: pointRepo },
        { provide: getRepositoryToken(SocialChest), useValue: chestRepo },
        { provide: ConfigManageService, useValue: configService },
        { provide: EventBusService, useValue: eventBus },
      ],
    }).compile();
    service = module.get(SocialEconomyService);
  });

  it('earnPoints 记 EARN 流水并 emit', async () => {
    pointRepo.findOne.mockResolvedValue(null);
    pointRepo.save.mockResolvedValue({ balanceAfter: 10 });
    const balance = await service.earnPoints('1', 10, SocialPointReason.FRIEND_ADDED, '2');
    expect(balance).toBe(10);
    expect(eventBus.emit).toHaveBeenCalledWith(GameEvents.SOCIAL_POINT_CHANGED, { playerId: '1', balance: 10 });
  });

  it('earnPoints 同 ref 去重不重复记账', async () => {
    pointRepo.findOne.mockResolvedValue({ id: 'x' });
    const balance = await service.earnPoints('1', 10, SocialPointReason.FRIEND_ADDED, '2');
    expect(balance).toBeNull();
    expect(pointRepo.save).not.toHaveBeenCalled();
  });

  it('earnPoints 超每日上限跳过', async () => {
    pointRepo.findOne.mockResolvedValue(null);
    configService.getConfig.mockResolvedValue({ value: '10' });
    qb.getRawOne.mockResolvedValueOnce({ total: '10' }); // getTodayEarned=10
    qb.getRawOne.mockResolvedValueOnce({ total: '0' }); // 不触发余额
    const balance = await service.earnPoints('1', 10, SocialPointReason.GIFT_SENT);
    expect(balance).toBeNull();
  });

  it('spendPoints 余额不足抛 POINT_NOT_ENOUGH', async () => {
    qb.getRawOne.mockResolvedValue({ total: '5' });
    await expect(
      service.spendPoints('1', 10, SocialPointReason.CHEST_EXCHANGE),
    ).rejects.toMatchObject({ response: { code: 92301 } });
  });

  it('exchangeChest 扣分并创建 PENDING 宝箱', async () => {
    qb.getRawOne
      .mockResolvedValueOnce({ total: '100' }) // earn=100
      .mockResolvedValueOnce({ total: '0' }); // spend=0
    chestRepo.save.mockResolvedValue({
      playerId: '1',
      chestType: SocialChestType.POINT_EXCHANGE,
      tier: 1,
      cost: 50,
      status: SocialChestStatus.PENDING,
    });
    const chest = await service.exchangeChest('1', 1);
    expect(chest.tier).toBe(1);
    expect(pointRepo.save).toHaveBeenCalled();
  });

  it('openChest 已开启拒绝', async () => {
    chestRepo.findOne.mockResolvedValue({
      id: 'c1',
      playerId: '1',
      status: SocialChestStatus.OPENED,
    });
    await expect(service.openChest('1', 'c1')).rejects.toMatchObject({
      response: { code: 92303 },
    });
  });

  it('claimWeeklyChests 上周活跃 70 发 3 档宝箱', async () => {
    chestRepo.find.mockResolvedValue([]);
    pointRepo.find.mockResolvedValue([
      { reason: SocialPointReason.FRIEND_ADDED, createdAt: new Date() },
    ]);
    jest.spyOn(service, 'getLastWeekActivity' as any).mockResolvedValue(70);
    chestRepo.save.mockImplementation((rows) => Promise.resolve(rows));
    const chests = await service.claimWeeklyChests('1');
    expect(chests.map((c) => c.tier).sort((a, b) => b - a)).toEqual([3, 2, 1]);
  });

  it('claimWeeklyChests 活跃不足抛 WEEKLY_CHEST_EMPTY', async () => {
    chestRepo.find.mockResolvedValue([]);
    jest.spyOn(service, 'getLastWeekActivity' as any).mockResolvedValue(5);
    await expect(service.claimWeeklyChests('1')).rejects.toMatchObject({
      response: { code: 92304 },
    });
  });

  it('adminAdjustPoints 补发正分记 EARN/ADMIN 流水并 emit', async () => {
    pointRepo.save.mockResolvedValue({ balanceAfter: 50 });
    const balance = await service.adminAdjustPoints('1', 50, 'gm1', '活动补偿');
    expect(balance).toBe(50);
    expect(pointRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: '1',
        type: SocialPointType.EARN,
        amount: 50,
        balanceAfter: 50,
        reason: SocialPointReason.ADMIN,
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(GameEvents.SOCIAL_POINT_CHANGED, {
      playerId: '1',
      balance: 50,
    });
  });

  it('adminAdjustPoints 回收导致负分抛 POINT_NOT_ENOUGH', async () => {
    await expect(
      service.adminAdjustPoints('1', -10, 'gm1'),
    ).rejects.toMatchObject({ response: { code: 92301 } });
    expect(pointRepo.save).not.toHaveBeenCalled();
  });

  it('adminAdjustPoints delta=0 抛 PARAM_INVALID', async () => {
    await expect(
      service.adminAdjustPoints('1', 0, 'gm1'),
    ).rejects.toMatchObject({ response: { code: 90003 } });
  });
});
