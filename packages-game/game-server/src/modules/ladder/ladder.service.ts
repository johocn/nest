import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { LadderRecord } from './entities';
import { GameEvents } from '@event-bus/game-events';
import { PlayerService } from '@modules/player/player.service';
import { ConfigManageService } from '@modules/config/config.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { AdminService } from '@modules/admin/admin.service';
import { CacheService } from '@cache/cache.service';
import { EconomyService } from '@modules/economy/economy.service';
import { CurrencyType, ConfigType } from '@constants/enums';

const TIER_BOUNDS: Array<{ tier: string; min: number }> = [
  { tier: '青铜', min: 1000 },
  { tier: '白银', min: 1100 },
  { tier: '黄金', min: 1300 },
  { tier: '宗师', min: 1600 },
];

/** 赛季前 N 名发奖 */
const SEASON_REWARDS: Array<{ rankMin: number; rankMax: number; vipExp: number; gold: number }> = [
  { rankMin: 1, rankMax: 1, vipExp: 5000, gold: 50000 },
  { rankMin: 2, rankMax: 3, vipExp: 3000, gold: 30000 },
  { rankMin: 4, rankMax: 10, vipExp: 1500, gold: 15000 },
  { rankMin: 11, rankMax: 50, vipExp: 500, gold: 5000 },
];

@Injectable()
export class LadderService {
  private readonly logger = new Logger(LadderService.name);

  private readonly ZSET_KEY = (season: string) => `ladder:zset:${season}`;

  constructor(
    @InjectRepository(LadderRecord)
    private readonly ladderRepo: Repository<LadderRecord>,
    private readonly playerService: PlayerService,
    private readonly configService: ConfigManageService,
    private readonly eventBus: EventBusService,
    private readonly adminService: AdminService,
    private readonly cacheService: CacheService,
    private readonly economyService: EconomyService,
  ) {}

  private async getSeason(): Promise<string> {
    const config = await this.configService
      .getConfig('ladder.season')
      .catch(() => null);
    return config?.value ?? '1';
  }

  private tierOf(score: number): string {
    let tier = '青铜';
    for (const t of TIER_BOUNDS) {
      if (score >= t.min) tier = t.tier;
    }
    return tier;
  }

  // ===== ZSet 缓存同步 =====

  /** 把某赛季 DB 全量刷进 Redis ZSet（冷启动 / 缓存丢失时调） */
  async refreshSeasonCache(season?: string): Promise<number> {
    const s = season ?? (await this.getSeason());
    const rows = await this.ladderRepo.find({ where: { season: s } });
    if (!rows.length) return 0;

    // zAdd 批量写
    const pipeline = rows.map((r) => this.cacheService.zAdd(this.ZSET_KEY(s), r.score, r.playerId));
    await Promise.all(pipeline);
    this.logger.log(`[Ladder] refreshSeasonCache season=${s} count=${rows.length}`);
    return rows.length;
  }

  /** 单个玩家的 score 同步到 ZSet（settleMatch 后自动调） */
  private async syncPlayerScore(playerId: string, score: number, season: string): Promise<void> {
    await this.cacheService.zAdd(this.ZSET_KEY(season), score, playerId);
  }

  // ===== 查询 =====

  async getRecord(playerId: string): Promise<LadderRecord> {
    const season = await this.getSeason();
    let record = await this.ladderRepo.findOne({
      where: { playerId, season },
    });
    if (!record) {
      record = await this.ladderRepo.save(
        this.ladderRepo.create({
          playerId,
          season,
          score: 1000,
          wins: 0,
          losses: 0,
          streak: 0,
        }),
      );
      // 新玩家 → 同步到 ZSet
      await this.syncPlayerScore(playerId, record.score, season);
    }
    return record;
  }

  async getInfo(playerId: string): Promise<{
    season: string;
    score: number;
    tier: string;
    wins: number;
    losses: number;
    streak: number;
    rank: number;
  }> {
    const record = await this.getRecord(playerId);
    const rank = await this.getRank(playerId, record.season);
    return {
      season: record.season,
      score: record.score,
      tier: this.tierOf(record.score),
      wins: record.wins,
      losses: record.losses,
      streak: record.streak,
      rank,
    };
  }

  /** 用 ZSet zRevRank O(log n) 取排名，不再全量扫 */
  async getRank(playerId: string, season: string): Promise<number> {
    const rank = await this.cacheService.zRevRank(this.ZSET_KEY(season), playerId);
    if (rank !== null && rank >= 0) return rank + 1;
    // ZSet 没这个玩家（冷缓存）→ 回退 DB 全量扫 + 重建
    this.logger.warn(`[Ladder] ZSet miss for ${playerId} season=${season}, fallback DB`);
    const rows = await this.ladderRepo.find({
      where: { season },
      order: { score: 'DESC' },
    });
    const found = rows.findIndex((r) => r.playerId === playerId);
    // 顺手重建这个玩家的 ZSet
    if (found >= 0) {
      await this.syncPlayerScore(playerId, rows[found].score, season);
    }
    return found >= 0 ? found + 1 : 0;
  }

  async getTopN(
    limit = 50,
  ): Promise<Array<{ playerId: string; score: number; tier: string; rank: number }>> {
    try {
      const season = await this.getSeason();
      const n = Math.min(Math.max(limit, 1), 100);

      const zRes = await this.cacheService.zRangeWithScores(
        this.ZSET_KEY(season), 0, n - 1, true,
      );

      if (!zRes?.length) {
        await this.refreshSeasonCache(season).catch(() => 0);
        const retried = await this.cacheService.zRangeWithScores(
          this.ZSET_KEY(season), 0, n - 1, true,
        ).catch(() => []);
        if (!retried?.length) return [];
        return retried.map((m, i) => ({
          playerId: m.value, score: m.score, tier: this.tierOf(m.score), rank: i + 1,
        }));
      }

      return zRes.map((m, i) => ({
        playerId: m.value, score: m.score, tier: this.tierOf(m.score), rank: i + 1,
      }));
    } catch (err) {
      this.logger.warn(`[Ladder] getTopN failed: ${(err as Error).message}`);
      return [];
    }
  }

  // ===== 结算（匹配成功后自动触发） =====

  @OnEvent(GameEvents.MATCH_SUCCESS)
  async settleMatch(payload: { mode: string; players: string[] }): Promise<void> {
    if (payload.mode !== 'ranked' || payload.players.length !== 2) return;
    const [a, b] = payload.players;
    try {
      const season = await this.getSeason();
      const [pa, pb, na, nb] = await Promise.all([
        this.playerService.getById(a),
        this.playerService.getById(b),
        this.playerService.isNewbie(a),
        this.playerService.isNewbie(b),
      ]);
      if (!pa || !pb) return;
      const powerA = pa.level * 1000 + Number(pa.exp);
      const powerB = pb.level * 1000 + Number(pb.exp);
      // 战力基准 + 随机 + 新手加成
      const baseWinRateA = 0.6 + (powerA - powerB) / powerB / 2;
      const newbieBoost = na.protected ? 0.15 : nb.protected ? -0.15 : 0;
      const winRateA = Math.min(0.95, Math.max(0.05, baseWinRateA + newbieBoost));
      const aWins = Math.random() < winRateA;

      const ra = await this.getRecord(a);
      const rb = await this.getRecord(b);
      const winner = aWins ? ra : rb;
      const loser = aWins ? rb : ra;
      winner.score += 20 + Math.min(winner.streak, 6) * 5;
      winner.wins += 1;
      winner.streak += 1;
      loser.score = Math.max(100, loser.score - 15);
      loser.losses += 1;
      loser.streak = 0;
      await this.ladderRepo.save([winner, loser]);

      // 同步 Redis ZSet
      await Promise.all([
        this.syncPlayerScore(winner.playerId, winner.score, season),
        this.syncPlayerScore(loser.playerId, loser.score, season),
      ]);

      this.eventBus.emit(GameEvents.LADDER_MATCH_SETTLED, {
        mode: 'ranked',
        winnerId: winner.playerId,
        loserId: loser.playerId,
        season,
      });
    } catch (err) {
      this.logger.error('Ladder settle failed', (err as Error).message);
    }
  }

  // ===== 赛季结算（Admin 触发 + 自动发奖） =====

  async settleSeason(adminId: string): Promise<{
    newSeason: string;
    rewarded: number;
    rewardsSent: number;
  }> {
    const season = await this.getSeason();

    // 1) 取 Top 50 发奖
    const top = await this.getTopN(50);
    let rewardsSent = 0;

    for (const entry of top) {
      const reward = SEASON_REWARDS.find(
        (r) => entry.rank >= r.rankMin && entry.rank <= r.rankMax,
      );
      if (!reward) continue;

      const opTrace = `ladder-season-${season}-rank-${entry.rank}`;
      try {
        if (reward.vipExp > 0) {
          await this.playerService.addVipExp(entry.playerId, reward.vipExp);
        }
        if (reward.gold > 0) {
          await this.economyService.addCurrency(
            entry.playerId,
            CurrencyType.GOLD,
            reward.gold,
            'ladder_season',
            opTrace,
          );
        }
        rewardsSent++;
      } catch (err) {
        this.logger.error(
          `[Ladder] season reward FAIL player=${entry.playerId} rank=${entry.rank}: ${(err as Error).message}`,
        );
      }
    }

    // 2) Admin 日志 + 切赛季
    await this.adminService.logOperation({
      adminId,
      operation: 'ladder.season.settle',
      changeBefore: { season, topCount: top.length },
      changeAfter: { rewardsSent, totalRecords: top.length },
    });

    const nextSeason = String(Number(season) + 1);
    await this.configService.setConfig(
      'ladder.season',
      nextSeason,
      ConfigType.STRING,
      '天梯当前赛季',
      adminId,
    );

    // 3) 刷新新赛季 ZSet（空的，玩家打第一场自动初始化 record）
    await this.cacheService.del(this.ZSET_KEY(season));

    this.eventBus.emit(GameEvents.LADDER_SEASON_SETTLED, {
      season,
      nextSeason,
      rewardsSent,
    });

    this.logger.log(`[Ladder] Season ${season} settled → ${nextSeason}, rewarded=${rewardsSent}`);
    return {
      newSeason: nextSeason,
      rewarded: top.filter((t) => t.score >= 1300).length,
      rewardsSent,
    };
  }
}
