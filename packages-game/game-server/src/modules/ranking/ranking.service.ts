import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RankingRecord } from './entities';
import { CacheService } from '@cache/cache.service';
import { RankingType } from '@constants/enums';

export interface RankEntry {
  playerId: string;
  playerName: string;
  rank: number;
  score: number;
}

@Injectable()
export class RankingService {
  private readonly RANKING_KEY = (type: RankingType) => `ranking:${type}`;

  constructor(
    @InjectRepository(RankingRecord)
    private readonly rankingRepo: Repository<RankingRecord>,
    private readonly cacheService: CacheService,
  ) {}

  async updateScore(
    type: RankingType,
    playerId: string,
    playerName: string,
    score: number,
  ): Promise<void> {
    await this.cacheService.zAdd(
      this.RANKING_KEY(type),
      score,
      JSON.stringify({ playerId, playerName }),
    );
  }

  async getTopN(type: RankingType, n: number): Promise<RankEntry[]> {
    const members = await this.cacheService.zRange(
      this.RANKING_KEY(type),
      0,
      -1,
    );
    const reversed = members.reverse().slice(0, n);

    return reversed.map((member, index) => {
      const parsed = JSON.parse(member);
      return {
        playerId: parsed.playerId,
        playerName: parsed.playerName,
        rank: index + 1,
        score: 0,
      };
    });
  }

  async getPlayerRank(type: RankingType, playerId: string): Promise<number> {
    const members = await this.cacheService.zRange(
      this.RANKING_KEY(type),
      0,
      -1,
    );
    const reversed = members.reverse();

    for (let i = 0; i < reversed.length; i++) {
      const parsed = JSON.parse(reversed[i]);
      if (parsed.playerId === playerId) {
        return i + 1;
      }
    }
    return 0;
  }

  async createSnapshot(type: RankingType): Promise<void> {
    const topEntries = await this.getTopN(type, 100);

    for (const entry of topEntries) {
      const record = this.rankingRepo.create({
        rankingType: type,
        playerId: entry.playerId,
        playerName: entry.playerName,
        rankValue: entry.score.toString(),
        rankOrder: entry.rank,
      });
      await this.rankingRepo.save(record);
    }
  }

  async getSnapshots(type: RankingType, limit = 50): Promise<RankingRecord[]> {
    return this.rankingRepo.find({
      where: { rankingType: type },
      order: { rankOrder: 'ASC', snapshotAt: 'DESC' },
      take: limit,
    });
  }

  async getSnapshotList(
    page: number,
    limit: number,
  ): Promise<{ items: RankingRecord[]; total: number }> {
    const [items, total] = await this.rankingRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { snapshotAt: 'DESC' },
    });
    return { items, total };
  }
}
