import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AchievementTemplate, PlayerAchievement } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  AchievementCategory,
  AchievementCondition,
  CurrencyType,
} from '@constants/enums';
import { EconomyService } from '@modules/economy/economy.service';

export interface ClaimAchievementResult {
  reward: Record<string, any>;
  isRewardClaimed: boolean;
}

/** increment: 在既有进度上累加；set: 直接写为绝对值（等级类快照条件） */
export type ProgressMode = 'increment' | 'set';

@Injectable()
export class AchievementService {
  private readonly logger = new Logger(AchievementService.name);

  constructor(
    @InjectRepository(AchievementTemplate)
    private readonly templateRepo: Repository<AchievementTemplate>,
    @InjectRepository(PlayerAchievement)
    private readonly playerAchievementRepo: Repository<PlayerAchievement>,
    private readonly eventBus: EventBusService,
    private readonly economyService: EconomyService,
  ) {}

  /**
   * AchievementCondition → conditionJson 可能包含的 JSON keys。
   * 与 admin controller 的 JSON_KEY_TO_ENUM 对称：Service 层用它在
   * conditionJson 里做包含匹配，确保 admin-web 创建的模板（condition
   * enum 列 fallback 成 REACH_LEVEL 或推断不到）也能被正确推进。
   */
  private static readonly CONDITION_TO_JSON_KEYS: Record<
    AchievementCondition,
    string[]
  > = {
    [AchievementCondition.KILL_COUNT]: ['kills', 'killCount'],
    [AchievementCondition.REACH_LEVEL]: ['target', 'level'],
    [AchievementCondition.COMPLETE_QUEST]: ['questId', 'questCount', 'quests'],
    [AchievementCondition.EARN_CURRENCY]: ['totalGold', 'currencyEarned', 'earn'],
    [AchievementCondition.JOIN_GUILD]: ['guildId', 'joinGuild'],
    [AchievementCondition.ADD_FRIEND]: ['friendCount', 'friends'],
    [AchievementCondition.WIN_COMBAT]: ['wins', 'winCount', 'winCombat'],
  };

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

  /**
   * 按成就条件推进进度：命中同一 condition 的所有模板逐一推进。
   * 单条模板失败只记日志，不阻断其余模板与调用方主流程。
   *
   * 模板匹配走两条路径然后去重合并：
   *   ① condition enum 列精确匹配 —— 正常流程（手写 migration / service 创建）
   *   ② conditionJson 包含匹配   —— admin-web 创建的模板 fallback
   *      （condition enum 列可能被推断或 fallback 成非期望值）
   */
  async advanceByCondition(
    playerId: string,
    condition: AchievementCondition,
    value: number,
    mode: ProgressMode = 'increment',
  ): Promise<void> {
    if (!Number.isFinite(value) || value <= 0) return;

    // ① enum 精确匹配
    const templatesByEnum = await this.templateRepo.find({ where: { condition } });

    // ② conditionJson 包含匹配（Postgres JSONB 的 ? 操作符检查顶层 key 是否存在）
    const jsonKeys = AchievementService.CONDITION_TO_JSON_KEYS[condition] ?? [];
    const templatesByJson =
      jsonKeys.length > 0
        ? await this.templateRepo
            .createQueryBuilder('t')
            .where(
              jsonKeys.map((k) => `t.condition_json::jsonb @> :json_${k}`).join(' OR '),
              Object.fromEntries(
                jsonKeys.map((k) => [`json_${k}`, JSON.stringify({ [k]: null })]),
              ),
            )
            .getMany()
        : [];

    // 去重合并
    const seen = new Set<string>();
    const templates = [...templatesByEnum, ...templatesByJson].filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    for (const template of templates) {
      try {
        await this.applyProgress(playerId, template, value, mode);
      } catch (err) {
        this.logger.error(
          `Achievement progress failed: player=${playerId} achievement=${template.id}`,
          (err as Error).message,
        );
      }
    }
  }

  private async applyProgress(
    playerId: string,
    template: AchievementTemplate,
    value: number,
    mode: ProgressMode,
  ): Promise<void> {
    let record = await this.playerAchievementRepo.findOne({
      where: { playerId, achievementId: template.id },
    });
    if (record?.isUnlocked) {
      return;
    }

    if (!record) {
      record = this.playerAchievementRepo.create({
        playerId,
        achievementId: template.id,
        currentValue: 0,
        isUnlocked: false,
        isRewardClaimed: false,
      });
    }

    const nextValue =
      mode === 'increment' ? record.currentValue + value : value;
    record.currentValue = nextValue;

    if (nextValue >= template.targetValue && !record.isUnlocked) {
      record.isUnlocked = true;
      record.unlockedAt = new Date();
      this.eventBus.emit(GameEvents.ACHIEVEMENT_UNLOCKED, {
        playerId,
        achievementId: template.id,
        achievementName: template.name,
      });
    }

    await this.playerAchievementRepo.save(record);
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

    // 原子占位：并发/连点时只有一个请求能把标记从 false 改成 true
    const claimed = await this.playerAchievementRepo.update(
      { id: record.id, isRewardClaimed: false },
      { isRewardClaimed: true },
    );
    if (!claimed.affected) {
      throw new GameException(
        ErrorCodes.ACHIEVEMENT_ALREADY_UNLOCKED,
        '奖励已领取',
      );
    }

    try {
      await this.deliverReward(playerId, achievementId, reward);
    } catch (err) {
      await this.playerAchievementRepo.update(
        { id: record.id },
        { isRewardClaimed: false },
      );
      throw err;
    }

    return { reward, isRewardClaimed: true };
  }

  /**
   * 发放成就奖励。rewardJson 采用扁平货币键约定（如 { gold: 500, diamond: 10 }），
   * 未识别的键记 warning，避免配置静默失效。
   */
  private async deliverReward(
    playerId: string,
    achievementId: string,
    reward: Record<string, any>,
  ): Promise<void> {
    const supported = Object.values(CurrencyType) as string[];

    for (const [key, raw] of Object.entries(reward ?? {})) {
      if (!supported.includes(key)) {
        this.logger.warn(
          `Unsupported achievement reward key: ${key} (achievement=${achievementId})`,
        );
        continue;
      }
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      await this.economyService.addCurrency(
        playerId,
        key as CurrencyType,
        amount,
        'achievement_reward',
        `achievement_reward:${playerId}:${achievementId}`,
        achievementId,
      );
    }
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

  /**
   * Admin 模板列表（与 getTemplates 等价，预留 filter 扩展位）。
   * admin-web 路由 GET /admin/v1/achievement/template/list 直接复用。
   */
  async listTemplates(
    page = 1,
    limit = 20,
  ): Promise<{ items: AchievementTemplate[]; total: number }> {
    return this.getTemplates(page, limit);
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

  async getTemplate(id: string): Promise<AchievementTemplate | null> {
    return this.templateRepo.findOne({ where: { id } });
  }

  // ===== Admin: PlayerAchievement =====

  async listPlayerAchievements(
    filter: { playerId?: string; achievementId?: string; isUnlocked?: boolean; isRewardClaimed?: boolean },
    page: number,
    limit: number,
  ): Promise<{ items: PlayerAchievement[]; total: number }> {
    const where: any = {};
    if (filter.playerId) where.playerId = filter.playerId;
    if (filter.achievementId) where.achievementId = filter.achievementId;
    if (filter.isUnlocked !== undefined) where.isUnlocked = filter.isUnlocked;
    if (filter.isRewardClaimed !== undefined) where.isRewardClaimed = filter.isRewardClaimed;
    const [items, total] = await this.playerAchievementRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getPlayerAchievementById(id: string): Promise<PlayerAchievement | null> {
    return this.playerAchievementRepo.findOne({ where: { id } });
  }

  async grantPlayerAchievement(
    playerId: string,
    achievementId: string,
  ): Promise<PlayerAchievement> {
    const template = await this.templateRepo.findOne({ where: { id: achievementId } });
    if (!template) {
      throw new GameException(ErrorCodes.ACHIEVEMENT_NOT_FOUND, '成就模板不存在');
    }
    let record = await this.playerAchievementRepo.findOne({
      where: { playerId, achievementId },
    });
    if (!record) {
      record = this.playerAchievementRepo.create({
        playerId,
        achievementId,
        currentValue: template.targetValue,
        isUnlocked: true,
        isRewardClaimed: false,
        unlockedAt: new Date(),
      });
    } else {
      record.currentValue = template.targetValue;
      record.isUnlocked = true;
      record.unlockedAt = record.unlockedAt ?? new Date();
    }
    return this.playerAchievementRepo.save(record);
  }

  async revokePlayerAchievement(id: string): Promise<PlayerAchievement | null> {
    const record = await this.playerAchievementRepo.findOne({ where: { id } });
    if (!record) return null;
    record.isUnlocked = false;
    record.currentValue = 0;
    record.unlockedAt = null;
    record.isRewardClaimed = false;
    return this.playerAchievementRepo.save(record);
  }

  async deletePlayerAchievement(id: string): Promise<void> {
    await this.playerAchievementRepo.delete(id);
  }
}
