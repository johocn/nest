import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { SocialPointRecord, SocialChest } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  SocialPointType,
  SocialPointReason,
  SocialChestType,
  SocialChestStatus,
} from '@constants/enums';
import { ConfigManageService } from '@modules/config/config.service';
import { getTodayStr } from '@utils/time.util';

const REASON_WEIGHTS: Record<string, number> = {
  friend_added: 3,
  kinship_formed: 5,
  gift_sent: 1,
  guild_contrib: 1,
  intel_gained: 2,
  chat_sign_in: 1,
  guide_task: 2,
};

@Injectable()
export class SocialEconomyService {
  constructor(
    @InjectRepository(SocialPointRecord)
    private readonly pointRepo: Repository<SocialPointRecord>,
    @InjectRepository(SocialChest)
    private readonly chestRepo: Repository<SocialChest>,
    private readonly configService: ConfigManageService,
    private readonly eventBus: EventBusService,
  ) {}

  async getBalance(playerId: string): Promise<number> {
    const [earn, spend] = await Promise.all([
      this.pointRepo
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'total')
        .where('p.player_id = :pid', { pid: playerId })
        .andWhere('p.type = :t', { t: SocialPointType.EARN })
        .getRawOne<{ total: string }>(),
      this.pointRepo
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'total')
        .where('p.player_id = :pid', { pid: playerId })
        .andWhere('p.type = :t', { t: SocialPointType.SPEND })
        .getRawOne<{ total: string }>(),
    ]);
    return Number(earn?.total ?? 0) - Number(spend?.total ?? 0);
  }

  async getTodayEarned(playerId: string): Promise<number> {
    const today = getTodayStr();
    const start = `${today} 00:00:00`;
    const row = await this.pointRepo
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount), 0)', 'total')
      .where('p.player_id = :pid', { pid: playerId })
      .andWhere('p.type = :t', { t: SocialPointType.EARN })
      .andWhere('p.created_at >= :start', { start })
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  async earnPoints(
    playerId: string,
    amount: number,
    reason: SocialPointReason,
    refId?: string,
  ): Promise<number | null> {
    if (amount <= 0) return null;
    if (refId) {
      const dup = await this.pointRepo.findOne({
        where: { playerId, reason, refId },
      });
      if (dup) return null;
    }
    const dailyCap = await this.readConfigNumber('social.point_daily_cap', 100);
    if ((await this.getTodayEarned(playerId)) + amount > dailyCap) {
      return null;
    }
    const balance = await this.getBalance(playerId);
    const record = await this.pointRepo.save(
      this.pointRepo.create({
        playerId,
        type: SocialPointType.EARN,
        amount,
        balanceAfter: balance + amount,
        reason,
        refId: refId ?? null,
      }),
    );
    this.eventBus.emit(GameEvents.SOCIAL_POINT_CHANGED, {
      playerId,
      balance: record.balanceAfter,
    });
    return record.balanceAfter;
  }

  async spendPoints(
    playerId: string,
    amount: number,
    reason: SocialPointReason,
    refId?: string,
  ): Promise<number> {
    if (amount <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '消耗数量非法');
    }
    const balance = await this.getBalance(playerId);
    if (balance < amount) {
      throw new GameException(ErrorCodes.POINT_NOT_ENOUGH, '社交积分不足');
    }
    const record = await this.pointRepo.save(
      this.pointRepo.create({
        playerId,
        type: SocialPointType.SPEND,
        amount,
        balanceAfter: balance - amount,
        reason,
        refId: refId ?? null,
      }),
    );
    this.eventBus.emit(GameEvents.SOCIAL_POINT_CHANGED, {
      playerId,
      balance: record.balanceAfter,
    });
    return record.balanceAfter;
  }

  /** admin 运营补发/回收社交积分：原因为 ADMIN，不受日上限限制，流水留痕 */
  async adminAdjustPoints(
    playerId: string,
    delta: number,
    operatorId: string,
    note?: string,
  ): Promise<number> {
    if (!delta) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '调整数量不能为 0');
    }
    const balance = await this.getBalance(playerId);
    const next = balance + delta;
    if (next < 0) {
      throw new GameException(ErrorCodes.POINT_NOT_ENOUGH, '回收后积分不可为负');
    }
    const type = delta > 0 ? SocialPointType.EARN : SocialPointType.SPEND;
    const record = await this.pointRepo.save(
      this.pointRepo.create({
        playerId,
        type,
        amount: Math.abs(delta),
        balanceAfter: next,
        reason: SocialPointReason.ADMIN,
        refId: `admin:${operatorId}:${note ?? 'adjust'}:${Date.now()}`,
      }),
    );
    this.eventBus.emit(GameEvents.SOCIAL_POINT_CHANGED, {
      playerId,
      balance: record.balanceAfter,
    });
    return record.balanceAfter;
  }

  async getPointInfo(playerId: string): Promise<{
    balance: number;
    todayEarned: number;
    dailyCap: number;
  }> {
    const [balance, todayEarned, dailyCap] = await Promise.all([
      this.getBalance(playerId),
      this.getTodayEarned(playerId),
      this.readConfigNumber('social.point_daily_cap', 100),
    ]);
    return { balance, todayEarned, dailyCap };
  }

  async getPointRecords(
    playerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: SocialPointRecord[]; total: number }> {
    const [items, total] = await this.pointRepo.findAndCount({
      where: { playerId },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getLastWeekActivity(playerId: string): Promise<number> {
    const now = new Date();
    const day = now.getDay() || 7; // 周一=1..周日=7
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day - 1) - 7);
    monday.setHours(0, 0, 0, 0);
    const end = new Date(monday);
    end.setDate(monday.getDate() + 7);
    const rows = await this.pointRepo.find({
      where: {
        playerId,
        type: SocialPointType.EARN,
        createdAt: MoreThanOrEqual(monday),
      },
    });
    let activity = 0;
    for (const r of rows) {
      if (r.createdAt < end) {
        activity += REASON_WEIGHTS[r.reason] ?? 1;
      }
    }
    return activity;
  }

  async exchangeChest(
    playerId: string,
    tier: number,
  ): Promise<SocialChest> {
    const costs: Record<number, number> = { 1: 50, 2: 150, 3: 400 };
    const cost = costs[tier];
    if (!cost) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '兑换档位非法');
    }
    await this.spendPoints(
      playerId,
      cost,
      SocialPointReason.CHEST_EXCHANGE,
      `tier:${tier}`,
    );
    return this.chestRepo.save(
      this.chestRepo.create({
        playerId,
        chestType: SocialChestType.POINT_EXCHANGE,
        tier,
        cost,
        status: SocialChestStatus.PENDING,
        sourceWeek: null,
      }),
    );
  }

  async claimWeeklyChests(playerId: string): Promise<SocialChest[]> {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day - 1) - 7);
    const weekKey = this.weekKey(monday);
    const existing = await this.chestRepo.find({
      where: { playerId, chestType: SocialChestType.WEEKLY_ACTIVITY, sourceWeek: weekKey },
    });
    if (existing.length) return existing;

    const activity = await this.getLastWeekActivity(playerId);
    const tiers: number[] = [];
    if (activity >= 100) tiers.push(4, 3, 2, 1);
    else if (activity >= 60) tiers.push(3, 2, 1);
    else if (activity >= 30) tiers.push(2, 1);
    else if (activity >= 10) tiers.push(1);
    if (!tiers.length) {
      throw new GameException(ErrorCodes.WEEKLY_CHEST_EMPTY, '上周活跃值未达 10，无宝箱可领');
    }
    const chests = await this.chestRepo.save(
      tiers.map((tier) =>
        this.chestRepo.create({
          playerId,
          chestType: SocialChestType.WEEKLY_ACTIVITY,
          tier,
          cost: 0,
          status: SocialChestStatus.PENDING,
          sourceWeek: weekKey,
        }),
      ),
    );
    return chests;
  }

  async openChest(playerId: string, chestId: string): Promise<SocialChest> {
    const chest = await this.chestRepo.findOne({ where: { id: chestId } });
    if (!chest) {
      throw new GameException(ErrorCodes.CHEST_NOT_FOUND, '宝箱不存在');
    }
    if (chest.playerId !== playerId) {
      throw new GameException(ErrorCodes.FORBIDDEN, '无权开启此宝箱');
    }
    if (chest.status === SocialChestStatus.OPENED) {
      throw new GameException(ErrorCodes.CHEST_ALREADY_OPENED, '宝箱已开启');
    }
    const table = await this.readConfigJson('social.chest_rewards', {});
    const pool = table[String(chest.tier)] ?? table['1'] ?? { gold: { weight: 1 } };
    const reward = this.rollReward(pool);
    chest.status = SocialChestStatus.OPENED;
    chest.rewardJson = reward;
    chest.openedAt = new Date();
    const saved = await this.chestRepo.save(chest);
    this.eventBus.emit(GameEvents.CHEST_OPENED, { playerId, chestId, reward });
    return saved;
  }

  private rollReward(pool: Record<string, { weight: number }>): Record<string, number> {
    const entries = Object.entries(pool);
    const total = entries.reduce((s, [, v]) => s + (v.weight ?? 1), 0);
    let roll = Math.random() * total;
    for (const [key, v] of entries) {
      roll -= v.weight ?? 1;
      if (roll <= 0) return { [key]: 1 };
    }
    return { [entries[0][0]]: 1 };
  }

  private weekKey(date: Date): string {
    const y = date.getFullYear();
    const start = new Date(y, 0, 1);
    const week = Math.ceil(((date.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
  }

  private async readConfigNumber(key: string, fallback: number): Promise<number> {
    try {
      const config = await this.configService.getConfig(key);
      return Number(config.value) || fallback;
    } catch {
      return fallback;
    }
  }

  private async readConfigJson(key: string, fallback: any): Promise<any> {
    try {
      const config = await this.configService.getConfig(key);
      return JSON.parse(config.value);
    } catch {
      return fallback;
    }
  }
}
