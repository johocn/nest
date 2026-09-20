import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { PlayerBehaviorLog, RetentionStat } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { BehaviorType, StatPeriod } from '@constants/enums';
import { Friend } from '@modules/social/entities/friend.entity';
import { Kinship } from '@modules/social/entities/kinship.entity';
import { GuildMember } from '@modules/social/entities/guild-member.entity';
import { Player } from '@modules/player/entities/player.entity';
import { ChatMessage } from '@modules/chat/entities/chat-message.entity';
import { Transaction } from '@modules/economy/entities/transaction.entity';
import type { Repository } from 'typeorm';

const makeQb = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
  getRawMany: jest.fn().mockResolvedValue([]),
  getRawOne: jest.fn().mockResolvedValue({ count: '0' }),
});

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let logRepo: jest.Mocked<Repository<PlayerBehaviorLog>>;
  let retentionRepo: jest.Mocked<Repository<RetentionStat>>;
  let friendRepo: jest.Mocked<Repository<Friend>>;
  let kinshipRepo: jest.Mocked<Repository<Kinship>>;
  let guildMemberRepo: jest.Mocked<Repository<GuildMember>>;
  let playerRepo: jest.Mocked<Repository<Player>>;
  let chatRepo: jest.Mocked<Repository<ChatMessage>>;
  let txRepo: jest.Mocked<Repository<Transaction>>;
  let eventBus: jest.Mocked<EventBusService>;

  let logQb: ReturnType<typeof makeQb>;
  let friendQb: ReturnType<typeof makeQb>;
  let txQb: ReturnType<typeof makeQb>;
  let chatQb: ReturnType<typeof makeQb>;
  let playerQb: ReturnType<typeof makeQb>;

  beforeEach(async () => {
    jest.clearAllMocks();
    logQb = makeQb();
    friendQb = makeQb();
    txQb = makeQb();
    chatQb = makeQb();
    playerQb = makeQb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: getRepositoryToken(PlayerBehaviorLog),
          useValue: {
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            createQueryBuilder: jest.fn(() => logQb),
          },
        },
        {
          provide: getRepositoryToken(RetentionStat),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: getRepositoryToken(Friend),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(() => friendQb),
          },
        },
        {
          provide: getRepositoryToken(Kinship),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(GuildMember),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(Player),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(() => playerQb),
          },
        },
        {
          provide: getRepositoryToken(ChatMessage),
          useValue: { createQueryBuilder: jest.fn(() => chatQb) },
        },
        {
          provide: getRepositoryToken(Transaction),
          useValue: { createQueryBuilder: jest.fn(() => txQb) },
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AnalyticsService);
    logRepo = module.get(getRepositoryToken(PlayerBehaviorLog));
    retentionRepo = module.get(getRepositoryToken(RetentionStat));
    friendRepo = module.get(getRepositoryToken(Friend));
    kinshipRepo = module.get(getRepositoryToken(Kinship));
    guildMemberRepo = module.get(getRepositoryToken(GuildMember));
    playerRepo = module.get(getRepositoryToken(Player));
    chatRepo = module.get(getRepositoryToken(ChatMessage));
    txRepo = module.get(getRepositoryToken(Transaction));
    eventBus = module.get(EventBusService);
  });

  describe('logBehavior', () => {
    it('should save behavior log and emit event', async () => {
      const result = await service.logBehavior('p1', BehaviorType.LOGIN, {
        device: 'mobile',
      });

      expect(result.playerId).toBe('p1');
      expect(result.behaviorType).toBe(BehaviorType.LOGIN);
      expect(eventBus.emit).toHaveBeenCalled();
    });
  });

  describe('getBehaviorStats', () => {
    it('should return behavior counts by type', async () => {
      logQb.getRawMany.mockResolvedValue([
        { behavior_type: 'login', count: '50' },
        { behavior_type: 'purchase', count: '20' },
      ]);

      const result = await service.getBehaviorStats(
        new Date(Date.now() - 86400000),
        new Date(),
      );

      expect(result).toHaveLength(2);
      expect(result[0].behaviorType).toBe('login');
      expect(result[0].count).toBe(50);
    });
  });

  describe('getDailyActiveUsers', () => {
    it('should return DAU count', async () => {
      logQb.getRawOne.mockResolvedValue({ count: '42' });

      const result = await service.getDailyActiveUsers(
        new Date().toISOString().slice(0, 10),
      );

      expect(result).toBe(42);
    });
  });

  describe('calculateRetention', () => {
    it('should calculate and save retention rate', async () => {
      logQb.getRawOne
        .mockResolvedValueOnce({ count: '100' })
        .mockResolvedValueOnce({ count: '25' });

      retentionRepo.findOne.mockResolvedValue(null);

      const result = await service.calculateRetention(
        '2026-07-01',
        '2026-07-02',
        StatPeriod.DAILY,
      );

      expect(result.cohortSize).toBe(100);
      expect(result.retainedCount).toBe(25);
      expect(result.retentionRate).toBe(25);
    });
  });

  describe('getRetentionStats', () => {
    it('should return retention records for a cohort date', async () => {
      retentionRepo.find.mockResolvedValue([
        {
          id: '1',
          cohortDate: '2026-07-01',
          retainedCount: 80,
          retentionRate: 80,
        },
      ] as any);

      const result = await service.getRetentionStats('2026-07-01');

      expect(result).toHaveLength(1);
    });
  });

  describe('getDashboard', () => {
    it('should return dashboard summary', async () => {
      logQb.getRawOne.mockResolvedValue({ count: '15' });
      logQb.getRawMany.mockResolvedValue([]);

      const result = await service.getDashboard();

      expect(result).toHaveProperty('dau');
      expect(result).toHaveProperty('behaviorStats');
      expect(result).toHaveProperty('generatedAt');
    });
  });

  // ===== 社交数据分析（13.8）=====

  describe('getSocialGraph', () => {
    it('图谱节点带度数、边去重', async () => {
      logQb.getRawMany.mockResolvedValue([
        { playerId: '1' },
        { playerId: '2' },
        { playerId: '3' },
      ]);
      playerRepo.find.mockResolvedValue([
        { id: '1', nickname: '甲' },
        { id: '2', nickname: '乙' },
        { id: '3', nickname: '丙' },
      ] as any);
      friendRepo.find.mockResolvedValue([
        { playerId: '1', friendId: '2' },
      ] as any);
      kinshipRepo.find.mockResolvedValue([
        { leaderId: '3', members: ['2', '3'] },
      ] as any);

      const result = await service.getSocialGraph(50);

      expect(result.nodes).toHaveLength(3);
      const node2 = result.nodes.find((n) => n.id === '2');
      expect(node2?.degree).toBe(2); // 好友1 + 亲缘1
      expect(result.edges).toContainEqual(
        expect.objectContaining({ type: 'friend' }),
      );
      expect(result.edges).toContainEqual(
        expect.objectContaining({ type: 'kinship' }),
      );
    });

    it('空数据不崩', async () => {
      logQb.getRawMany.mockResolvedValue([]);
      friendRepo.find.mockResolvedValue([]);
      kinshipRepo.find.mockResolvedValue([]);
      const result = await service.getSocialGraph(50);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });
  });

  describe('getSocialHubs', () => {
    it('枢纽按度数降序', async () => {
      friendRepo.find.mockResolvedValue([
        { playerId: '1', friendId: '2' },
        { playerId: '2', friendId: '1' },
      ] as any);
      kinshipRepo.find.mockResolvedValue([
        { leaderId: '1', members: ['1', '2'] },
      ] as any);
      playerRepo.find.mockResolvedValue([
        { id: '1', nickname: '甲' },
        { id: '2', nickname: '乙' },
      ] as any);

      const result = await service.getSocialHubs(10);

      expect(result).toHaveLength(2);
      expect(result[0].degree).toBeGreaterThanOrEqual(result[1].degree);
      expect(result[0].friendCount).toBe(2);
      expect(result[0].kinshipCount).toBe(1);
    });
  });

  describe('getChurnRisks', () => {
    it('近7天有登录且社交动作降幅≥50% 进入风险名单', async () => {
      logQb.getRawMany.mockResolvedValue([{ playerId: '1' }]);
      // recent 窗口：无动作；prev 窗口：好友2条 + 送礼1条 + 聊天1条 = 4
      friendQb.getRawMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { playerId: '1', friendId: '2' },
          { playerId: '1', friendId: '3' },
        ]);
      txQb.getRawMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ playerId: '1' }]);
      chatQb.getRawMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ senderId: '1' }]);
      playerRepo.find.mockResolvedValue([
        { id: '1', nickname: '侠客一' },
      ] as any);

      const result = await service.getChurnRisks(7);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        playerId: '1',
        nickname: '侠客一',
        prevCount: 4,
        recentCount: 0,
        dropRate: 100,
        riskLevel: 'high',
      });
    });

    it('无历史或未登录不预警', async () => {
      logQb.getRawMany.mockResolvedValue([]);
      const result = await service.getChurnRisks(7);
      expect(result).toEqual([]);
    });
  });

  describe('getSocialFunnel', () => {
    it('好友/入帮/亲缘任一即算建立关系', async () => {
      playerQb.getMany.mockResolvedValue([
        { id: '1' },
        { id: '2' },
        { id: '3' },
      ] as any);
      friendRepo.find.mockResolvedValue([
        { playerId: '1', friendId: '99' },
      ] as any);
      guildMemberRepo.find.mockResolvedValue([{ playerId: '2' }] as any);
      kinshipRepo.find.mockResolvedValue([
        { leaderId: '3', members: ['3'] },
      ] as any);

      const result = await service.getSocialFunnel(7);

      expect(result.newPlayerCount).toBe(3);
      expect(result.relatedCount).toBe(3);
      expect(result.relationRate).toBe(100);
      expect(result.healthy).toBe(true);
      expect(result.detail).toEqual({
        withFriend: 1,
        withGuild: 1,
        withKinship: 1,
      });
    });

    it('无新玩家返回零值', async () => {
      playerQb.getMany.mockResolvedValue([]);
      const result = await service.getSocialFunnel(7);
      expect(result.newPlayerCount).toBe(0);
      expect(result.healthy).toBe(false);
    });
  });
});
