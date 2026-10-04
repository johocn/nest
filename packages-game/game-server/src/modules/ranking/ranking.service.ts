import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { RankingRecord } from './entities';
import { CacheService } from '@cache/cache.service';
import { RankingType } from '@constants/enums';

export interface RankEntry {
  playerId: string;
  playerName: string;
  rank: number;
  score: number;
}

/** 每种排行榜对应两套 Redis key：ZSet 存排名值、Hash 存玩家名 → 避免 JSON.parse 开销 */
const zKey = (type: RankingType) => `ranking:z:${type}`;
const nameKey = (type: RankingType) => `ranking:names:${type}`;

@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);

  constructor(
    @InjectRepository(RankingRecord)
    private readonly rankingRepo: Repository<RankingRecord>,
    private readonly cacheService: CacheService,
  ) {}

  /** 更新玩家分数（或首次入榜）—— 同时维护 ZSet score 和 Hash playerName */
  async updateScore(
    type: RankingType,
    playerId: string,
    playerName: string,
    score: number,
  ): Promise<void> {
    await Promise.all([
      this.cacheService.zAdd(zKey(type), score, playerId),
      this.cacheService.hSet(nameKey(type), playerId, playerName),
    ]);
  }

  /** Top N —— ZSet 降序取 + Hash 批量查名字；O(log N + M)，M=请求量 */
  async getTopN(type: RankingType, n: number): Promise<RankEntry[]> {
    const members = await this.cacheService.zRangeWithScores(zKey(type), 0, n - 1, true);
    if (members.length === 0) return [];

    // 并行 hGet 每个 playerId 的名字；空值回退 '未知玩家'
    const names = await Promise.all(
      members.map((m) =>
        this.cacheService.hGet(nameKey(type), m.value).catch(() => null),
      ),
    );
    return members.map((m, i) => ({
      playerId: m.value,
      playerName: names[i] ?? '',
      rank: i + 1,
      score: Number(m.score),
    }));
  }

  /** O(log n) 原生排名查询 —— 用 Redis zRevRank 降序排中的位置 */
  async getPlayerRank(type: RankingType, playerId: string): Promise<number> {
    const revRank = await this.cacheService.zRevRank(zKey(type), playerId);
    if (revRank === null) return 0;
    return revRank + 1; // Redis 返回 0-based rank → 业务层 1-based
  }

  /** 玩家分数（用于客户端展示当前值）—— zScore */
  async getPlayerScore(type: RankingType, playerId: string): Promise<number | null> {
    const raw = await this.cacheService.getRawClient().zScore(zKey(type), playerId);
    return raw === null ? null : Number(raw);
  }

  /** 玩家离榜/重置时移除（同时清 ZSet + Hash） */
  async removePlayer(type: RankingType, playerId: string): Promise<void> {
    await Promise.all([
      this.cacheService.zRem(zKey(type), playerId),
      this.cacheService.hDel(nameKey(type), playerId),
    ]);
  }

  /** 全榜移除（账号注销用） */
  async removePlayerFromAll(playerId: string): Promise<RankingType[]> {
    const removed: RankingType[] = [];
    for (const type of Object.values(RankingType) as RankingType[]) {
      await this.removePlayer(type, playerId);
      removed.push(type);
    }
    return removed;
  }

  // ===== 快照（Admin 手动触发 / 定时） =====

  async createSnapshot(type: RankingType): Promise<number> {
    const entries = await this.getTopN(type, 100);
    if (entries.length === 0) return 0;

    const records = entries.map((e) =>
      this.rankingRepo.create({
        rankingType: type,
        playerId: e.playerId,
        playerName: e.playerName,
        rankValue: String(Math.trunc(e.score)),
        rankOrder: e.rank,
      }),
    );
    const saved = await this.rankingRepo.save(records);
    this.logger.log(`[Ranking] 快照 ${type} 共 ${saved.length} 条`);
    return saved.length;
  }

  async getSnapshotList(
    page: number,
    limit: number,
    type?: RankingType,
  ): Promise<{ items: RankingRecord[]; total: number }> {
    const where = type ? { rankingType: type } : {};
    const [items, total] = await this.rankingRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { snapshotAt: 'DESC', rankOrder: 'ASC' },
    });
    return { items, total };
  }

  /** 兼容旧调用：按类型取最新快照（spec 用） */
  async getSnapshots(type: RankingType, limit = 50): Promise<RankingRecord[]> {
    return this.rankingRepo.find({
      where: { rankingType: type },
      order: { rankOrder: 'ASC', snapshotAt: 'DESC' },
      take: limit,
    });
  }

  // ===== Redis 冷启动恢复 =====

  /**
   * 从 DB 快照重建 Redis ZSet —— 用于 Redis flush 后恢复。
   * 取每种类型最新快照的 Top 1000，逐个 zAdd + hSet。
   */
  async refreshFromDB(type?: RankingType): Promise<number> {
    const types = type ? [type] : (Object.values(RankingType) as RankingType[]);
    let total = 0;

    for (const t of types) {
      const latest = await this.rankingRepo.findOne({
        where: { rankingType: t },
        order: { snapshotAt: 'DESC', rankOrder: 'ASC' },
      });
      if (!latest) continue;

      const snapshots = await this.rankingRepo.find({
        where: { rankingType: t, snapshotAt: latest.snapshotAt },
        order: { rankOrder: 'ASC' },
        take: 1000,
      });

      // 降序注入：rankOrder=1 的分数最高 → zAdd 时 score 越大排名越高
      // 直接用 rankOrder 反比（1001 - rankOrder）作临时分数 —— 快照只有名次无原分数
      const pipeline: Promise<void>[] = [];
      for (const s of snapshots) {
        const score = Number(s.rankValue) || 1001 - s.rankOrder;
        pipeline.push(
          Promise.all([
            this.cacheService.zAdd(zKey(t), score, s.playerId),
            this.cacheService.hSet(nameKey(t), s.playerId, s.playerName),
          ]).then(() => {}),
        );
      }
      await Promise.all(pipeline);
      total += snapshots.length;
      this.logger.log(`[Ranking] refreshFromDB ${t} → ${snapshots.length}`);
    }
    return total;
  }

  /** 每小时整点自动快照 + 从 DB 回灌（Redis 冷启动恢复） */
  @Cron('0 0 * * * *')
  async hourlyRefresh(): Promise<void> {
    this.logger.log('[Ranking] hourlyRefresh 触发');
    try {
      for (const type of Object.values(RankingType) as RankingType[]) {
        await this.createSnapshot(type);
      }
      await this.refreshFromDB();
    } catch (err) {
      this.logger.error(`[Ranking] hourlyRefresh 失败: ${String(err)}`);
    }
  }
}
