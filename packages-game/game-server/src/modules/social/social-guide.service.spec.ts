import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SocialGuideService } from './social-guide.service';
import { GuideProgress } from './entities';
import { GuideTaskStatus } from '@constants/enums';
import { SocialEconomyService } from './social-economy.service';
import { PlayerService } from '@modules/player/player.service';
import { ConfigManageService } from '@modules/config/config.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { EconomyService } from '@modules/economy/economy.service';
import { GameEvents } from '@event-bus/game-events';

describe('SocialGuideService', () => {
  let service: SocialGuideService;
  const guideRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((e) => e),
  };
  const economyService = { earnPoints: jest.fn() };
  const playerService = { getById: jest.fn() };
  const configService = { getConfig: jest.fn() };
  const eventBus = { emit: jest.fn() };
  const currencyService = { addCurrency: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    playerService.getById.mockResolvedValue({
      id: '1',
      createdAt: new Date(Date.now() - 2 * 86400000),
    });
    const module = await Test.createTestingModule({
      providers: [
        SocialGuideService,
        { provide: getRepositoryToken(GuideProgress), useValue: guideRepo },
        { provide: SocialEconomyService, useValue: economyService },
        { provide: PlayerService, useValue: playerService },
        { provide: ConfigManageService, useValue: configService },
        { provide: EventBusService, useValue: eventBus },
        { provide: EconomyService, useValue: currencyService },
      ],
    }).compile();
    service = module.get(SocialGuideService);
  });

  it('completeTask 首次完成建档并 emit', async () => {
    guideRepo.findOne.mockResolvedValue(null);
    guideRepo.save.mockImplementation((e) => Promise.resolve(e));
    await service.completeTask('1', 'friend');
    expect(guideRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'friend',
        day: 3,
        status: GuideTaskStatus.DONE,
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      GameEvents.GUIDE_TASK_COMPLETED,
      expect.any(Object),
    );
  });

  it('completeTask 重复完成不重复建档', async () => {
    guideRepo.findOne.mockResolvedValue({
      id: 'x',
      playerId: '1',
      taskId: 'friend',
      status: GuideTaskStatus.DONE,
    });
    await service.completeTask('1', 'friend');
    expect(guideRepo.save).not.toHaveBeenCalled();
  });

  it('claimTaskReward 已领取拒绝', async () => {
    guideRepo.findOne.mockResolvedValue({
      id: 'x',
      playerId: '1',
      taskId: 'gift',
      status: GuideTaskStatus.REWARDED,
    });
    await expect(service.claimTaskReward('1', 'gift')).rejects.toMatchObject({
      response: { code: 92702 },
    });
  });

  it('claimTaskReward 未完成拒绝', async () => {
    guideRepo.findOne.mockResolvedValue(null);
    await expect(service.claimTaskReward('1', 'escort')).rejects.toMatchObject({
      response: { code: 92701 },
    });
  });

  it('claimTaskReward 完成发放积分与金币', async () => {
    guideRepo.findOne.mockResolvedValue({
      id: 'x',
      playerId: '1',
      taskId: 'gift',
      status: GuideTaskStatus.DONE,
    });
    economyService.earnPoints.mockResolvedValue(20);
    currencyService.addCurrency.mockResolvedValue(undefined);
    guideRepo.save.mockImplementation((e) => Promise.resolve(e));
    const r = await service.claimTaskReward('1', 'gift');
    expect(r.points).toBe(20);
    expect(currencyService.addCurrency).toHaveBeenCalled();
  });

  it('claimTaskReward sworn 额外发放里程碑钻石', async () => {
    guideRepo.findOne.mockResolvedValue({
      id: 'x',
      playerId: '1',
      taskId: 'sworn',
      status: GuideTaskStatus.DONE,
    });
    economyService.earnPoints.mockResolvedValue(20);
    configService.getConfig.mockResolvedValue({ value: '50' });
    guideRepo.save.mockImplementation((e) => Promise.resolve(e));
    await service.claimTaskReward('1', 'sworn');
    expect(currencyService.addCurrency).toHaveBeenCalledTimes(2);
  });

  it('getDailyGuide 返回当日任务与 rewardReady', async () => {
    guideRepo.find.mockResolvedValue([
      {
        id: 'x',
        playerId: '1',
        taskId: 'friend',
        status: GuideTaskStatus.DONE,
      },
    ]);
    const guide = await service.getDailyGuide('1');
    expect(guide.day).toBe(3);
    expect(guide.title).toBe('初涉江湖');
    expect(guide.tasks[0].id).toBe('intel');
    expect(guide.rewardReady).toBe(false);
  });
});
