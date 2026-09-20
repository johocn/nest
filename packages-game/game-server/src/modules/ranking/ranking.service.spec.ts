import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RankingService } from './ranking.service';
import { RankingRecord } from './entities';
import { CacheService } from '@cache/cache.service';
import { RankingType } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('RankingService', () => {
  let service: RankingService;
  let rankingRepo: jest.Mocked<Repository<RankingRecord>>;
  let cacheService: jest.Mocked<CacheService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingService,
        {
          provide: getRepositoryToken(RankingRecord),
          useValue: {
            find: jest.fn(),
            save: jest.fn(),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: CacheService,
          useValue: {
            zAdd: jest.fn(),
            zRange: jest.fn(),
            zRem: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(RankingService);
    rankingRepo = module.get(getRepositoryToken(RankingRecord));
    cacheService = module.get(CacheService);
  });

  describe('updateScore', () => {
    it('should add player score to Redis ZSet', async () => {
      await service.updateScore(RankingType.POWER, 'p1', '张三', 5000);

      expect(cacheService.zAdd).toHaveBeenCalledWith(
        'ranking:power',
        5000,
        JSON.stringify({ playerId: 'p1', playerName: '张三' }),
      );
    });
  });

  describe('getTopN', () => {
    it('should return top N players from Redis', async () => {
      cacheService.zRange.mockResolvedValue([
        JSON.stringify({ playerId: 'p1', playerName: '张三' }),
        JSON.stringify({ playerId: 'p2', playerName: '李四' }),
      ]);

      const result = await service.getTopN(RankingType.POWER, 10);

      expect(result).toHaveLength(2);
      expect(result[0].playerId).toBe('p2'); // reversed from ascending ZSet
    });

    it('should return empty array when no rankings', async () => {
      cacheService.zRange.mockResolvedValue([]);

      const result = await service.getTopN(RankingType.POWER, 10);

      expect(result).toEqual([]);
    });
  });

  describe('getPlayerRank', () => {
    it('should return rank number for player', async () => {
      cacheService.zRange.mockResolvedValue([
        JSON.stringify({ playerId: 'p1', playerName: '张三' }),
        JSON.stringify({ playerId: 'p2', playerName: '李四' }),
        JSON.stringify({ playerId: 'p3', playerName: '王五' }),
      ]);

      const result = await service.getPlayerRank(RankingType.POWER, 'p2');

      expect(result).toBe(2);
    });
  });

  describe('removePlayer', () => {
    it('should remove matching player from Redis ZSet', async () => {
      cacheService.zRange.mockResolvedValue([
        JSON.stringify({ playerId: 'p1', playerName: '张三' }),
        JSON.stringify({ playerId: 'p2', playerName: '李四' }),
      ]);

      await service.removePlayer(RankingType.POWER, 'p1');

      expect(cacheService.zRem).toHaveBeenCalledWith(
        'ranking:power',
        JSON.stringify({ playerId: 'p1', playerName: '张三' }),
      );
    });

    it('should skip zRem when player not in ZSet', async () => {
      cacheService.zRange.mockResolvedValue([
        JSON.stringify({ playerId: 'p2', playerName: '李四' }),
      ]);

      await service.removePlayer(RankingType.POWER, 'p1');

      expect(cacheService.zRem).not.toHaveBeenCalled();
    });

    it('should skip malformed members without throwing', async () => {
      cacheService.zRange.mockResolvedValue(['not-json', '123']);

      await expect(
        service.removePlayer(RankingType.POWER, 'p1'),
      ).resolves.toBeUndefined();
      expect(cacheService.zRem).not.toHaveBeenCalled();
    });
  });

  describe('removePlayerFromAll', () => {
    it('should remove player from every ranking type', async () => {
      cacheService.zRange.mockResolvedValue([
        JSON.stringify({ playerId: 'p1', playerName: '张三' }),
      ]);

      const removed = await service.removePlayerFromAll('p1');

      expect(removed).toEqual(Object.values(RankingType));
      expect(cacheService.zRem).toHaveBeenCalled();
    });
  });

  describe('createSnapshot', () => {
    it('should save current rankings to DB', async () => {
      cacheService.zRange.mockResolvedValue([
        JSON.stringify({ playerId: 'p1', playerName: '张三' }),
      ]);

      await service.createSnapshot(RankingType.POWER);

      expect(rankingRepo.save).toHaveBeenCalled();
    });
  });

  describe('getSnapshots', () => {
    it('should return historical snapshots', async () => {
      rankingRepo.find.mockResolvedValue([
        {
          id: '1',
          rankingType: RankingType.POWER,
          playerId: 'p1',
          playerName: '张三',
          rankValue: '5000',
          rankOrder: 1,
          snapshotAt: new Date(),
        } as RankingRecord,
      ]);

      const result = await service.getSnapshots(RankingType.POWER, 10);

      expect(result).toHaveLength(1);
    });
  });

  describe('getSnapshotList (admin)', () => {
    it('should return paginated snapshots', async () => {
      rankingRepo.findAndCount.mockResolvedValue([
        [
          {
            id: '1',
            rankingType: RankingType.POWER,
            playerId: 'p1',
            playerName: '张三',
            rankValue: '5000',
            rankOrder: 1,
            snapshotAt: new Date(),
          } as RankingRecord,
        ],
        1,
      ]);

      const result = await service.getSnapshotList(1, 20);

      expect(result.items).toHaveLength(1);
    });
  });
});
