import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AchievementTemplate, PlayerAchievement } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { AchievementCategory } from '@constants/enums';

export interface ClaimAchievementResult {
  reward: Record<string, any>;
  isRewardClaimed: boolean;
}

@Injectable()
export class AchievementService {
  constructor(
    @InjectRepository(AchievementTemplate)
    private readonly templateRepo: Repository<AchievementTemplate>,
    @InjectRepository(PlayerAchievement)
    private readonly playerAchievementRepo: Repository<PlayerAchievement>,
    private readonly eventBus: EventBusService,
  ) {}

  async updateProgress(
    playerId: string,
    achievementId: string,
    currentValue: number,
  ): Promise<PlayerAchievement> {
    const template = await this.templateRepo.findOne({
      where: { id: achievementId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.ACHIEVEMENT_NOT_FOUND, '成就不存在');
    }

    let record = await this.playerAchievementRepo.findOne({
      where: { playerId, achievementId },
    });

    if (record && record.isUnlocked) {
      return record; // Already unlocked, no further updates
    }

    if (!record) {
      record = this.playerAchievementRepo.create({
        playerId,
        achievementId,
        currentValue: 0,
        isUnlocked: false,
        isRewardClaimed: false,
      });
    }

    record.currentValue = currentValue;

    if (currentValue >= template.targetValue && !record.isUnlocked) {
      record.isUnlocked = true;
      record.unlockedAt = new Date();
      this.eventBus.emit(GameEvents.ACHIEVEMENT_UNLOCKED, {
        playerId,
        achievementId,
        achievementName: template.name,
      });
    }

    return this.playerAchievementRepo.save(record);
  }

  async claimReward(
    playerId: string,
    achievementId: string,
  ): Promise<ClaimAchievementResult> {
    const record = await this.playerAchievementRepo.findOne({
      where: { playerId, achievementId },
    });
    if (!record) {
      throw new GameException(
        ErrorCodes.ACHIEVEMENT_NOT_FOUND,
        '成就记录不存在',
      );
    }
    if (!record.isUnlocked) {
      throw new GameException(
        ErrorCodes.ACHIEVEMENT_CONDITION_NOT_MET,
        '成就未解锁',
      );
    }
    if (record.isRewardClaimed) {
      throw new GameException(
        ErrorCodes.ACHIEVEMENT_ALREADY_UNLOCKED,
        '奖励已领取',
      );
    }

    const template = await this.templateRepo.findOne({
      where: { id: achievementId },
    });
    const reward = template?.rewardJson ?? {};

    record.isRewardClaimed = true;
    await this.playerAchievementRepo.save(record);

    return { reward, isRewardClaimed: true };
  }

  async getPlayerAchievements(playerId: string): Promise<PlayerAchievement[]> {
    return this.playerAchievementRepo.find({ where: { playerId } });
  }

  async getAchievementList(
    category?: AchievementCategory,
  ): Promise<AchievementTemplate[]> {
    if (category) {
      return this.templateRepo.find({
        where: { category },
        order: { sortOrder: 'ASC' },
      });
    }
    return this.templateRepo.find({ order: { sortOrder: 'ASC' } });
  }

  // ===== Admin CRUD =====

  async getTemplates(
    page: number,
    limit: number,
  ): Promise<{ items: AchievementTemplate[]; total: number }> {
    const [items, total] = await this.templateRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async createTemplate(
    data: Partial<AchievementTemplate>,
  ): Promise<AchievementTemplate> {
    const template = this.templateRepo.create(data);
    return this.templateRepo.save(template);
  }

  async updateTemplate(
    id: string,
    data: Partial<AchievementTemplate>,
  ): Promise<AchievementTemplate | null> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) return null;
    Object.assign(template, data);
    return this.templateRepo.save(template);
  }
}
