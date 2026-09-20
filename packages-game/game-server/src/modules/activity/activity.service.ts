import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  LessThanOrEqual,
  MoreThanOrEqual,
  MoreThan,
  In,
} from 'typeorm';
import { ActivityTemplate, PlayerActivity, SignInRecord } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  ActivityType,
  ActivityStatus,
  SignInCycle,
  QuestStatus,
} from '@constants/enums';
import { FAVOR_RANKS, GUILD_ROLE_RANKS, favorRankOf } from '@constants/ranks';
import { AdminService } from '@modules/admin/admin.service';
import { CharacterService } from '@modules/character/character.service';
import { SocialService } from '@modules/social/social.service';
import { PlayerQuest } from '@modules/quest/entities';
import { Player } from '@modules/player/entities/player.entity';
import { PlayerBehaviorLog } from '@modules/analytics/entities/player-behavior-log.entity';
import { BehaviorType } from '@constants/enums';

export interface ClaimRewardResult {
  reward: Record<string, any>;
  isRewardClaimed: boolean;
}

export interface ActivityDashboard {
  activityId: string;
  participantCount: number;
  signInCount: number;
  todaySignInCount: number;
  rewardClaimedCount: number;
  levelDistribution: Record<string, number>;
  nextDayRetentionRate: number | null;
  dailyTrend: { date: string; participants: number }[];
  generatedAt: string;
}

const PUBLISH_OPERATION = 'activity.publish';

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityTemplate)
    private readonly templateRepo: Repository<ActivityTemplate>,
    @InjectRepository(PlayerActivity)
    private readonly playerActivityRepo: Repository<PlayerActivity>,
    @InjectRepository(SignInRecord)
    private readonly signInRepo: Repository<SignInRecord>,
    @InjectRepository(Player)
    private readonly playerRepo: Repository<Player>,
    @InjectRepository(PlayerBehaviorLog)
    private readonly behaviorLogRepo: Repository<PlayerBehaviorLog>,
    @InjectRepository(PlayerQuest)
    private readonly playerQuestRepo: Repository<PlayerQuest>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
    private readonly adminService: AdminService,
    private readonly characterService: CharacterService,
    private readonly socialService: SocialService,
  ) {}

  async getActiveActivities(playerId?: string): Promise<ActivityTemplate[]> {
    const now = new Date();
    const templates = await this.templateRepo.find({
      where: {
        status: In([ActivityStatus.ACTIVE, ActivityStatus.GRAY]),
        startAt: LessThanOrEqual(now),
        endAt: MoreThanOrEqual(now),
      },
      order: { startAt: 'ASC' },
    });
    if (!playerId) {
      return templates.filter((t) => t.status === ActivityStatus.ACTIVE);
    }
    return templates.filter(
      (t) =>
        t.status === ActivityStatus.ACTIVE ||
        this.isWhitelisted(t, playerId),
    );
  }

  private isWhitelisted(
    template: ActivityTemplate,
    playerId: string,
  ): boolean {
    const whitelist = template.grayWhitelistJson ?? {};
    if (Array.isArray(whitelist)) {
      return whitelist.includes(playerId);
    }
    if (typeof whitelist === 'string') {
      return this.matchPercent(whitelist, playerId);
    }
    if (Array.isArray(whitelist.playerIds)) {
      if (whitelist.playerIds.includes(playerId)) return true;
    }
    if (whitelist.percent) {
      return this.matchPercent(String(whitelist.percent), playerId);
    }
    return false;
  }

  private matchPercent(percentStr: string, playerId: string): boolean {
    const percent = parseInt(percentStr.replace('%', ''), 10);
    if (Number.isNaN(percent) || percent <= 0) return false;
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
      hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
    }
    return hash % 100 < Math.min(percent, 100);
  }

  private assertPlayable(
    template: ActivityTemplate,
    playerId: string,
  ): void {
    if (template.status !== ActivityStatus.ACTIVE) {
      if (
        template.status === ActivityStatus.GRAY &&
        this.isWhitelisted(template, playerId)
      ) {
        return;
      }
      throw new GameException(
        template.status === ActivityStatus.GRAY
          ? ErrorCodes.ACTIVITY_WHITELIST_REJECTED
          : ErrorCodes.ACTIVITY_NOT_ACTIVE,
        template.status === ActivityStatus.GRAY
          ? '活动灰度中，不在白名单内'
          : '活动未开放',
      );
    }
  }

  /** 参与条件（condition_json）：level / questIds / favorLevel / guildRole，缺失即不限制 */
  private async assertConditions(
    template: ActivityTemplate,
    playerId: string,
  ): Promise<void> {
    const cond = template.conditionJson ?? {};

    if (cond.level !== undefined) {
      const player = await this.playerRepo.findOne({
        where: { id: playerId },
      });
      if (!player) {
        throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
      }
      if (player.level < Number(cond.level)) {
        throw new GameException(
          ErrorCodes.ACTIVITY_CONDITION_NOT_MET,
          '等级不足，无法参与',
        );
      }
    }

    if (Array.isArray(cond.questIds) && cond.questIds.length > 0) {
      const done = await this.playerQuestRepo.count({
        where: {
          playerId,
          questTemplateId: In(cond.questIds.map(String)),
          status: QuestStatus.CLAIMED,
        },
      });
      if (done < cond.questIds.length) {
        throw new GameException(
          ErrorCodes.ACTIVITY_CONDITION_NOT_MET,
          '前置任务未完成',
        );
      }
    }

    if (cond.favorLevel !== undefined) {
      const relationships =
        await this.characterService.getRelationships(playerId);
      const required = FAVOR_RANKS[cond.favorLevel] ?? 0;
      const maxRank = relationships.reduce((max, rel) => {
        const rank = rel.level
          ? FAVOR_RANKS[rel.level] ?? 0
          : favorRankOf(rel.favorability);
        return Math.max(max, rank);
      }, 0);
      if (maxRank < required) {
        throw new GameException(
          ErrorCodes.ACTIVITY_CONDITION_NOT_MET,
          '好感档位不足',
        );
      }
    }

    if (cond.guildRole !== undefined) {
      const myRole = await this.socialService.getMyGuildRole(playerId);
      const required = GUILD_ROLE_RANKS[cond.guildRole] ?? 0;
      const rank = myRole ? GUILD_ROLE_RANKS[myRole.role] ?? 0 : 0;
      if (rank < required) {
        throw new GameException(
          ErrorCodes.ACTIVITY_CONDITION_NOT_MET,
          '帮派职位不足',
        );
      }
    }
  }

  async joinActivity(
    playerId: string,
    activityId: string,
  ): Promise<PlayerActivity> {
    const template = await this.templateRepo.findOne({
      where: { id: activityId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_FOUND, '活动不存在');
    }

    const now = new Date();
    this.assertPlayable(template, playerId);
    if (now < template.startAt || now > template.endAt) {
      throw new GameException(
        ErrorCodes.ACTIVITY_NOT_ACTIVE,
        '活动不在有效期内',
      );
    }
    await this.assertConditions(template, playerId);

    const existing = await this.playerActivityRepo.findOne({
      where: { playerId, activityId },
    });
    if (existing) {
      throw new GameException(
        ErrorCodes.ACTIVITY_ALREADY_SIGNED,
        '已参加该活动',
      );
    }

    const playerActivity = this.playerActivityRepo.create({
      playerId,
      activityId,
      activityType: template.activityType,
      progress: 0,
      isRewardClaimed: false,
      joinedAt: now,
    });
    return this.playerActivityRepo.save(playerActivity);
  }

  async signIn(playerId: string, activityId: string): Promise<SignInRecord> {
    const template = await this.templateRepo.findOne({
      where: { id: activityId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_FOUND, '活动不存在');
    }

    const now = new Date();
    this.assertPlayable(template, playerId);
    if (now < template.startAt || now > template.endAt) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_ACTIVE, '活动未开放');
    }
    await this.assertConditions(template, playerId);

    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86400000)
      .toISOString()
      .slice(0, 10);

    // Check if already signed in today
    const todayRecord = await this.signInRepo.findOne({
      where: { playerId, activityId, signInDate: today },
    });
    if (todayRecord) {
      throw new GameException(ErrorCodes.ACTIVITY_ALREADY_SIGNED, '今日已签到');
    }

    // Check yesterday's record for consecutive days
    const yesterdayRecord = await this.signInRepo.findOne({
      where: { playerId, activityId, signInDate: yesterday },
    });

    const consecutiveDays = yesterdayRecord
      ? yesterdayRecord.consecutiveDays + 1
      : 1;

    const record = this.signInRepo.create({
      playerId,
      activityId,
      signInDate: today,
      signInCycle: template.signInCycle ?? SignInCycle.DAILY,
      consecutiveDays,
      rewardClaimed: false,
    });
    const saved = await this.signInRepo.save(record);

    this.eventBus.emit(GameEvents.SIGN_IN_COMPLETED, {
      playerId,
      activityId,
      consecutiveDays,
      signInDate: today,
    });

    return saved;
  }

  async claimReward(
    playerId: string,
    activityId: string,
  ): Promise<ClaimRewardResult> {
    const playerActivity = await this.playerActivityRepo.findOne({
      where: { playerId, activityId },
    });
    if (!playerActivity) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_FOUND, '未参加该活动');
    }
    if (playerActivity.isRewardClaimed) {
      throw new GameException(ErrorCodes.ACTIVITY_REWARD_CLAIMED, '奖励已领取');
    }

    const template = await this.templateRepo.findOne({
      where: { id: activityId },
    });
    const reward = template?.rewardJson ?? {};

    playerActivity.isRewardClaimed = true;
    await this.playerActivityRepo.save(playerActivity);

    return { reward, isRewardClaimed: true };
  }

  async getPlayerActivities(playerId: string): Promise<PlayerActivity[]> {
    return this.playerActivityRepo.find({ where: { playerId } });
  }

  // ===== 运营工作台（13.6 预配置→灰度→回滚）=====

  private snapshot(template: ActivityTemplate): Record<string, any> {
    return {
      id: template.id,
      status: template.status,
      conditionJson: template.conditionJson,
      rewardJson: template.rewardJson,
      startAt: template.startAt,
      endAt: template.endAt,
      grayWhitelistJson: template.grayWhitelistJson,
    };
  }

  async publishActivity(
    adminId: string,
    activityId: string,
    grayWhitelist?: unknown,
  ): Promise<ActivityTemplate> {
    const template = await this.templateRepo.findOne({
      where: { id: activityId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_FOUND, '活动不存在');
    }
    if (template.status !== ActivityStatus.DRAFT) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_ACTIVE, '仅草稿可发布');
    }

    const before = this.snapshot(template);
    const whitelist = this.normalizeWhitelist(grayWhitelist);
    const useGray = this.hasWhitelist(whitelist);
    template.grayWhitelistJson = whitelist;
    template.status = useGray ? ActivityStatus.GRAY : ActivityStatus.ACTIVE;
    template.publishedVersion += 1;
    template.publishedAt = new Date();
    const saved = await this.templateRepo.save(template);

    await this.adminService.logOperation({
      adminId,
      targetPlayerId: activityId,
      operation: PUBLISH_OPERATION,
      changeBefore: before,
      changeAfter: {
        id: saved.id,
        status: saved.status,
        publishedVersion: saved.publishedVersion,
      },
    });
    return saved;
  }

  private normalizeWhitelist(raw: unknown): Record<string, any> {
    if (raw === undefined || raw === null || raw === '') return {};
    if (typeof raw === 'string' || Array.isArray(raw)) {
      return raw as Record<string, any>;
    }
    return raw as Record<string, any>;
  }

  private hasWhitelist(whitelist: any): boolean {
    if (Array.isArray(whitelist)) return whitelist.length > 0;
    if (typeof whitelist === 'string') return whitelist.trim().length > 0;
    if (Array.isArray(whitelist.playerIds) && whitelist.playerIds.length > 0) {
      return true;
    }
    return Boolean(whitelist.percent);
  }

  async grayVerifyActivity(
    adminId: string,
    activityId: string,
    passed: boolean,
  ): Promise<ActivityTemplate> {
    const template = await this.templateRepo.findOne({
      where: { id: activityId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_FOUND, '活动不存在');
    }
    if (template.status !== ActivityStatus.GRAY) {
      throw new GameException(
        ErrorCodes.ACTIVITY_NOT_ACTIVE,
        '仅灰度中活动可验证',
      );
    }

    const before = this.snapshot(template);
    if (passed) {
      template.status = ActivityStatus.ACTIVE;
    } else {
      template.status = ActivityStatus.DRAFT;
      template.grayWhitelistJson = {};
    }
    const saved = await this.templateRepo.save(template);

    await this.adminService.logOperation({
      adminId,
      targetPlayerId: activityId,
      operation: passed ? 'activity.gray_verify_pass' : 'activity.gray_verify_fail',
      changeBefore: before,
      changeAfter: {
        id: saved.id,
        status: saved.status,
        publishedVersion: saved.publishedVersion,
      },
    });
    return saved;
  }

  async rollbackActivity(
    adminId: string,
    activityId: string,
  ): Promise<ActivityTemplate> {
    const template = await this.templateRepo.findOne({
      where: { id: activityId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_FOUND, '活动不存在');
    }

    const publishLog = await this.adminService.findLatestOperation(
      PUBLISH_OPERATION,
      { id: activityId },
    );
    if (!publishLog) {
      throw new GameException(
        ErrorCodes.ACTIVITY_NOT_PUBLISHED,
        '该活动无发布记录，无法回滚',
      );
    }

    const before = this.snapshot(template);
    const snapshot = publishLog.changeBefore as Record<string, any>;
    template.status = ActivityStatus.DRAFT;
    template.conditionJson = snapshot.conditionJson ?? {};
    template.rewardJson = snapshot.rewardJson ?? {};
    template.startAt = snapshot.startAt ?? template.startAt;
    template.endAt = snapshot.endAt ?? template.endAt;
    template.grayWhitelistJson = {};
    const saved = await this.templateRepo.save(template);

    await this.adminService.logOperation({
      adminId,
      targetPlayerId: activityId,
      operation: 'activity.rollback',
      changeBefore: before,
      changeAfter: {
        id: saved.id,
        status: saved.status,
        publishedVersion: saved.publishedVersion,
      },
    });
    return saved;
  }

  async getActivityDashboard(
    activityId: string,
    days = 7,
  ): Promise<ActivityDashboard> {
    const template = await this.templateRepo.findOne({
      where: { id: activityId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_FOUND, '活动不存在');
    }

    const [participantCount, signInCount, rewardClaimedCount] =
      await Promise.all([
        this.playerActivityRepo.count({ where: { activityId } }),
        this.signInRepo.count({ where: { activityId } }),
        this.playerActivityRepo.count({
          where: { activityId, isRewardClaimed: true },
        }),
      ]);

    const today = new Date().toISOString().slice(0, 10);
    const todaySignInCount = await this.signInRepo.count({
      where: { activityId, signInDate: today },
    });

    const participants = await this.playerActivityRepo.find({
      where: { activityId },
    });
    const ids = participants.map((p) => p.playerId);

    const levelDistribution: Record<string, number> = {};
    if (ids.length > 0) {
      const players = await this.playerRepo.find({
        where: { id: In(ids) },
        select: { id: true, level: true },
      });
      for (const p of players) {
        const key = String(p.level);
        levelDistribution[key] = (levelDistribution[key] ?? 0) + 1;
      }
    }

    let nextDayRetentionRate: number | null = null;
    if (ids.length > 0) {
      const joinedLogs = await this.behaviorLogRepo.find({
        where: { playerId: In(ids), behaviorType: BehaviorType.LOGIN },
        select: { playerId: true, createdAt: true },
      });
      const joinedAtById = new Map(
        participants.map((p) => [p.playerId, p.joinedAt.getTime()]),
      );
      const returned = new Set<string>();
      for (const log of joinedLogs) {
        const joinedAt = joinedAtById.get(log.playerId);
        if (!joinedAt) continue;
        const nextDay = joinedAt + 24 * 3600 * 1000;
        const nextDayEnd = nextDay + 24 * 3600 * 1000;
        const ts = log.createdAt.getTime();
        if (ts >= nextDay && ts < nextDayEnd) returned.add(log.playerId);
      }
      nextDayRetentionRate =
        Math.round((returned.size / ids.length) * 10000) / 100;
    }

    // joined_at 由 DB now()（UTC）写入，趋势窗口在 SQL 端与 now() 同源同基准比较
    const trendRows = await this.playerActivityRepo
      .createQueryBuilder('pa')
      .select("to_char(pa.joined_at, 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('pa.activity_id = :activityId', { activityId })
      .andWhere("pa.joined_at >= now() - (:ago * interval '1 day')", {
        ago: days - 1,
      })
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany();
    const dailyTrend = trendRows.map((r: any) => ({
      date: r.date,
      participants: parseInt(r.count, 10),
    }));

    return {
      activityId,
      participantCount,
      signInCount,
      todaySignInCount,
      rewardClaimedCount,
      levelDistribution,
      nextDayRetentionRate,
      dailyTrend,
      generatedAt: new Date().toISOString(),
    };
  }

  // ===== Admin CRUD =====

  async getTemplates(
    page: number,
    limit: number,
  ): Promise<{ items: ActivityTemplate[]; total: number }> {
    const [items, total] = await this.templateRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async createTemplate(
    data: Partial<ActivityTemplate>,
  ): Promise<ActivityTemplate> {
    const template = this.templateRepo.create(data);
    return this.templateRepo.save(template);
  }

  async updateTemplate(
    id: string,
    data: Partial<ActivityTemplate>,
  ): Promise<ActivityTemplate | null> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) return null;
    Object.assign(template, data);
    return this.templateRepo.save(template);
  }
}
