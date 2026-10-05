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
            save: jest.fn().mockImplementation((rows) => Promise.resolve(rows)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: CacheService,
          useValue: {
            zAdd: jest.fn().mockResolvedValue(1),
            zRange: jest.fn(),
            zRangeWithScores: jest.fn(),
            zRevRank: jest.fn(),
            zRem: jest.fn(),
            zScore: jest.fn(),
            hSet: jest.fn().mockResolvedValue(1),
            hGet: jest.fn(),
            hGetAll: jest.fn(),
            hDel: jest.fn().mockResolvedValue(1),
            get: jest.fn(),
            set: jest.fn(),
            getRawClient: jest.fn(() => ({ zScore: jest.fn() })),
            hDel: jest.fn().mockResolvedValue(1),
            del: jest.fn(),
            exists: jest.fn(),
            sAdd: jest.fn(),
            sRem: jest.fn(),
            sMembers: jest.fn(),
            expire: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(RankingService);
    rankingRepo = module.get(getRepositoryToken(RankingRecord));
    cacheService = module.get(CacheService);
  });

  describe('updateScore', () => {
    it('should update both ZSet score and Hash playerName', async () => {
      await service.updateScore(RankingType.POWER, 'p1', '张三', 5000);

      expect(cacheService.zAdd).toHaveBeenCalledWith(
        'ranking:z:power',
        5000,
        'p1',
      );
      expect(cacheService.hSet).toHaveBeenCalledWith(
        'ranking:names:power',
        'p1',
        '张三',
      );
    });
  });

  describe('getTopN', () => {
    it('should return top N players with real scores, highest first', async () => {
      cacheService.zRangeWithScores.mockResolvedValue([
        { value: 'p2', score: 900 },
        { value: 'p1', score: 500 },
      ]);
      cacheService.hGet.mockImplementation(async (_key: string, id: string) => {
        const map: Record<string, string> = { p1: '张三', p2: '李四' };
        return map[id] ?? '';
      });

      const result = await service.getTopN(RankingType.POWER, 10);

      expect(cacheService.zRangeWithScores).toHaveBeenCalledWith(
        'ranking:z:power',
        0,
        9,
        true,
      );
      expect(result).toEqual([
        { playerId: 'p2', playerName: '李四', rank: 1, score: 900 },
        { playerId: 'p1', playerName: '张三', rank: 2, score: 500 },
      ]);
    });

    it('should return empty array when no rankings', async () => {
      cacheService.zRangeWithScores.mockResolvedValue([]);

      await expect(service.getTopN(RankingType.POWER, 10)).resolves.toEqual(
        [],
      );
    });

    it('should use empty string when name not in hash', async () => {
      cacheService.zRangeWithScores.mockResolvedValue([
        { value: 'p1', score: 500 },
      ]);
      cacheService.hGet.mockResolvedValue(null);

      const result = await service.getTopN(RankingType.POWER, 10);
      expect(result[0].playerName).toBe('');
    });
  });

  describe('getPlayerRank', () => {
    it('should return rank number using zRevRank', async () => {
      cacheService.zRevRank.mockResolvedValue(1);

      const result = await service.getPlayerRank(RankingType.POWER, 'p1');

      expect(cacheService.zRevRank).toHaveBeenCalledWith(
        'ranking:z:power',
        'p1',
      );
      expect(result).toBe(2); // 0-based → 1-based
    });

    it('should return 0 when player not in ZSet', async () => {
      cacheService.zRevRank.mockResolvedValue(null);

      const result = await service.getPlayerRank(RankingType.POWER, 'p1');
      expect(result).toBe(0);
    });
  });

  describe('removePlayer', () => {
    it('should remove from both ZSet and Hash', async () => {
      await service.removePlayer(RankingType.POWER, 'p1');

      expect(cacheService.zRem).toHaveBeenCalledWith('ranking:z:power', 'p1');
      expect(cacheService.hDel).toHaveBeenCalledWith(
        'ranking:names:power',
        'p1',
      );
    });
  });

  describe('removePlayerFromAll', () => {
    it('should remove player from every ranking type', async () => {
      const removed = await service.removePlayerFromAll('p1');

      expect(removed).toEqual(Object.values(RankingType));
      expect(cacheService.zRem).toHaveBeenCalled();
    });
  });

  describe('createSnapshot', () => {
    it('should persist top entries to DB with integer scores', async () => {
      cacheService.zRangeWithScores.mockResolvedValue([
        { value: 'p1', score: 5000.7 },
      ]);
      cacheService.hGet.mockResolvedValue('张三');

      await service.createSnapshot(RankingType.POWER);

      expect(rankingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          rankingType: RankingType.POWER,
          playerId: 'p1',
          rankValue: '5000',
          rankOrder: 1,
        }),
      );
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
