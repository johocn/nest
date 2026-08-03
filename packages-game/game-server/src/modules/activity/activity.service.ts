import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { ActivityTemplate, PlayerActivity, SignInRecord } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ActivityType, ActivityStatus, SignInCycle } from '@constants/enums';

export interface ClaimRewardResult {
  reward: Record<string, any>;
  isRewardClaimed: boolean;
}

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityTemplate)
    private readonly templateRepo: Repository<ActivityTemplate>,
    @InjectRepository(PlayerActivity)
    private readonly playerActivityRepo: Repository<PlayerActivity>,
    @InjectRepository(SignInRecord)
    private readonly signInRepo: Repository<SignInRecord>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async getActiveActivities(): Promise<ActivityTemplate[]> {
    const now = new Date();
    return this.templateRepo.find({
      where: {
        status: ActivityStatus.ACTIVE,
        startAt: LessThanOrEqual(now),
        endAt: MoreThanOrEqual(now),
      },
      order: { startAt: 'ASC' },
    });
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
    if (template.status !== ActivityStatus.ACTIVE) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_ACTIVE, '活动未开放');
    }
    if (now < template.startAt || now > template.endAt) {
      throw new GameException(
        ErrorCodes.ACTIVITY_NOT_ACTIVE,
        '活动不在有效期内',
      );
    }

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
    if (
      template.status !== ActivityStatus.ACTIVE ||
      now < template.startAt ||
      now > template.endAt
    ) {
      throw new GameException(ErrorCodes.ACTIVITY_NOT_ACTIVE, '活动未开放');
    }

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
