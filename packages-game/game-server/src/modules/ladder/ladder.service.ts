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
import { ConfigType } from '@constants/enums';

const TIER_BOUNDS: Array<{ tier: string; min: number }> = [
  { tier: '青铜', min: 1000 },
  { tier: '白银', min: 1100 },
  { tier: '黄金', min: 1300 },
  { tier: '宗师', min: 1600 },
];

@Injectable()
export class LadderService {
  private readonly logger = new Logger(LadderService.name);

  constructor(
    @InjectRepository(LadderRecord)
    private readonly ladderRepo: Repository<LadderRecord>,
    private readonly playerService: PlayerService,
    private readonly configService: ConfigManageService,
    private readonly eventBus: EventBusService,
    private readonly adminService: AdminService,
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

  async getRank(playerId: string, season: string): Promise<number> {
    const rows = await this.ladderRepo.find({
      where: { season },
      order: { score: 'DESC' },
    });
    return rows.findIndex((r) => r.playerId === playerId) + 1;
  }

  async getTopN(
    limit = 50,
  ): Promise<Array<{ playerId: string; score: number; tier: string }>> {
    const season = await this.getSeason();
    const rows = await this.ladderRepo.find({
      where: { season },
      order: { score: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((r) => ({
      playerId: r.playerId,
      score: r.score,
      tier: this.tierOf(r.score),
    }));
  }

  @OnEvent(GameEvents.MATCH_SUCCESS)
  async settleMatch(payload: { mode: string; players: string[] }): Promise<void> {
    if (payload.mode !== 'ranked' || payload.players.length !== 2) return;
    const [a, b] = payload.players;
    try {
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

      this.eventBus.emit(GameEvents.LADDER_MATCH_SETTLED, {
        mode: 'ranked',
        winnerId: winner.playerId,
        loserId: loser.playerId,
        season: await this.getSeason(),
      });
    } catch (err) {
      this.logger.error('Ladder settle failed', (err as Error).message);
    }
  }

  async settleSeason(adminId: string): Promise<{ newSeason: string; rewarded: number }> {
    const season = await this.getSeason();
    const rows = await this.ladderRepo.find({ where: { season } });
    const rewarded = rows.filter((r) => r.score >= 1300).length;
    await this.adminService.logOperation({
      adminId,
      operation: 'ladder.season.settle',
      changeBefore: { season },
      changeAfter: { rewarded },
    });
    const nextSeason = String(Number(season) + 1);
    await this.configService.setConfig(
      'ladder.season',
      nextSeason,
      ConfigType.NUMBER,
      '天梯当前赛季',
      adminId,
    );
    this.eventBus.emit(GameEvents.LADDER_SEASON_SETTLED, {
      season,
      nextSeason,
      rewarded,
    });
    return { newSeason: nextSeason, rewarded };
  }
}
