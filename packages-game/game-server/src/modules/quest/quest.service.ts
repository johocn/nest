import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { QuestTemplate, PlayerQuest, QuestHelpRequest } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  QuestStatus,
  SocialTargetType,
  QuestHelpStatus,
  CurrencyType,
} from '@constants/enums';
import {
  FAVOR_RANKS,
  GUILD_ROLE_RANKS,
  INTEL_GRADE_RANKS,
  favorRankOf,
} from '@constants/ranks';
import { CharacterService } from '@modules/character/character.service';
import { SocialService } from '@modules/social/social.service';
import { PlayerService } from '@modules/player/player.service';
import { EconomyService } from '@modules/economy/economy.service';
import { CacheService } from '@cache/cache.service';

export interface QuestWithTemplate {
  playerQuest: PlayerQuest;
  template: QuestTemplate;
}

export interface SubmitQuestResult {
  questId: string;
  reward: Record<string, any>;
  socialReward?: Record<string, any>;
  status: QuestStatus;
}

@Injectable()
export class QuestService {
  private readonly logger = new Logger(QuestService.name);

  private static readonly SOCIAL_CURRENCIES = [
    CurrencyType.FAVOR,
    CurrencyType.GUILD_CONTRIB,
    CurrencyType.FACE,
  ];

  private static readonly ECO_DAILY_LIMIT = 10;
  private static readonly ECO_DAILY_TTL_SECONDS = 86400;
  private static readonly ECO_DAILY_LIMITED_TARGETS: SocialTargetType[] = [
    SocialTargetType.VIEW_ARTICLE,
    SocialTargetType.VIEW_COURSE,
    SocialTargetType.VIEW_PRODUCT,
    SocialTargetType.VIEW_PRICE,
    SocialTargetType.VIEW_ACTIVITY,
    SocialTargetType.LIKE,
    SocialTargetType.COMMENT,
  ];

  constructor(
    @InjectRepository(QuestTemplate)
    private readonly templateRepo: Repository<QuestTemplate>,
    @InjectRepository(PlayerQuest)
    private readonly playerQuestRepo: Repository<PlayerQuest>,
    @InjectRepository(QuestHelpRequest)
    private readonly questHelpRepo: Repository<QuestHelpRequest>,
    private readonly eventBus: EventBusService,
    private readonly characterService: CharacterService,
    private readonly socialService: SocialService,
    private readonly economyService: EconomyService,
    private readonly cacheService: CacheService,
    private readonly playerService: PlayerService,
  ) {}

  async acceptQuest(
    playerId: string,
    questTemplateId: string,
  ): Promise<PlayerQuest> {
    const template = await this.templateRepo.findOne({
      where: { id: questTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.QUEST_NOT_ACCEPTED, '任务模板不存在');
    }

    // 等级门槛以库中玩家数据为唯一来源，避免调用方漏传导致校验失效
    const player = await this.playerService.getById(playerId);
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }
    if (player.level < template.minLevel) {
      throw new GameException(
        ErrorCodes.QUEST_PREREQUISITE_NOT_MET,
        '等级不足',
      );
    }

    await this.assertPrerequisiteQuests(playerId, template);

    if (template.prerequisiteSocial) {
      await this.checkPrerequisiteSocial(playerId, template.prerequisiteSocial);
    }

    await this.assertAcceptLimit(playerId, template);

    const existing = await this.playerQuestRepo.findOne({
      where: { playerId, questTemplateId },
    });
    if (existing && !template.repeatable) {
      throw new GameException(
        ErrorCodes.QUEST_ALREADY_COMPLETED,
        '任务已接取且不可重复',
      );
    }

    const playerQuest = this.playerQuestRepo.create({
      playerId,
      questTemplateId,
      progress: 0,
      status: QuestStatus.IN_PROGRESS,
      acceptedAt: new Date(),
    });
    const saved = await this.playerQuestRepo.save(playerQuest);

    this.eventBus.emit(GameEvents.QUEST_ACCEPTED, {
      playerId,
      questTemplateId,
    });

    return saved;
  }

  /** 前置任务链：prerequisiteIds 必须全部处于已领奖（CLAIMED）状态 */
  private async assertPrerequisiteQuests(
    playerId: string,
    template: QuestTemplate,
  ): Promise<void> {
    const required = template.prerequisiteIds ?? [];
    if (required.length === 0) return;
    const done = await this.playerQuestRepo.count({
      where: {
        playerId,
        questTemplateId: In(required.map(String)),
        status: QuestStatus.CLAIMED,
      },
    });
    if (done < required.length) {
      throw new GameException(
        ErrorCodes.QUEST_PREREQUISITE_NOT_MET,
        '前置任务未完成',
      );
    }
  }

  /** 接取次数上限：acceptLimit <= 0 视为不限 */
  private async assertAcceptLimit(
    playerId: string,
    template: QuestTemplate,
  ): Promise<void> {
    if (!template.acceptLimit || template.acceptLimit <= 0) return;
    const accepted = await this.playerQuestRepo.count({
      where: { playerId, questTemplateId: template.id },
    });
    if (accepted >= template.acceptLimit) {
      throw new GameException(
        ErrorCodes.QUEST_ACCEPT_LIMIT_REACHED,
        '接取次数已达上限',
      );
    }
  }

  private async checkPrerequisiteSocial(
    playerId: string,
    prerequisiteSocial: Record<string, any>,
  ): Promise<void> {
    const [intelligences, relationships, myGuildRole, friends] =
      await Promise.all([
        this.socialService.getIntelligences(playerId),
        this.characterService.getRelationships(playerId),
        this.socialService.getMyGuildRole(playerId),
        this.socialService.getFriendList(playerId),
      ]);

    if (prerequisiteSocial.intelGrade !== undefined) {
      const required = INTEL_GRADE_RANKS[prerequisiteSocial.intelGrade] ?? 0;
      const maxRank = intelligences.reduce(
        (max, it) => Math.max(max, INTEL_GRADE_RANKS[it.grade] ?? 0),
        0,
      );
      if (maxRank < required) {
        throw new GameException(ErrorCodes.QUEST_SOCIAL_PRE_REQ, '情报等级不足');
      }
    }

    if (prerequisiteSocial.intelCount !== undefined) {
      if (intelligences.length < prerequisiteSocial.intelCount) {
        throw new GameException(ErrorCodes.QUEST_SOCIAL_PRE_REQ, '情报数量不足');
      }
    }

    if (prerequisiteSocial.favorLevel !== undefined) {
      const required = FAVOR_RANKS[prerequisiteSocial.favorLevel] ?? 0;
      let maxRank = 0;
      for (const rel of relationships) {
        let rank: number;
        if (rel.level) {
          rank = FAVOR_RANKS[rel.level] ?? 0;
        } else {
          rank = favorRankOf(rel.favorability);
        }
        maxRank = Math.max(maxRank, rank);
      }
      if (maxRank < required) {
        throw new GameException(ErrorCodes.QUEST_SOCIAL_PRE_REQ, '好感档位不足');
      }
    }

    if (prerequisiteSocial.guildRole !== undefined) {
      const required = GUILD_ROLE_RANKS[prerequisiteSocial.guildRole] ?? 0;
      const roleRank = myGuildRole
        ? GUILD_ROLE_RANKS[myGuildRole.role] ?? 0
        : 0;
      if (roleRank < required) {
        throw new GameException(ErrorCodes.QUEST_SOCIAL_PRE_REQ, '公会职位不足');
      }
    }

    if (prerequisiteSocial.friendCount !== undefined) {
      if (friends.length < prerequisiteSocial.friendCount) {
        throw new GameException(ErrorCodes.QUEST_SOCIAL_PRE_REQ, '好友数量不足');
      }
    }
  }

  async submitQuest(
    playerId: string,
    questTemplateId: string,
  ): Promise<SubmitQuestResult> {
    const playerQuest = await this.playerQuestRepo.findOne({
      where: { playerId, questTemplateId },
    });
    if (!playerQuest || playerQuest.status !== QuestStatus.IN_PROGRESS) {
      throw new GameException(
        ErrorCodes.QUEST_NOT_ACCEPTED,
        '任务未接取或已领取',
      );
    }

    const template = await this.templateRepo.findOne({
      where: { id: questTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.QUEST_NOT_ACCEPTED, '任务模板不存在');
    }

    // Check if target reached
    const targetCount =
      template.targetJson?.kill_count ?? template.targetJson?.count ?? 0;
    if (targetCount > 0 && playerQuest.progress < targetCount) {
      throw new GameException(
        ErrorCodes.QUEST_PREREQUISITE_NOT_MET,
        '任务目标未达成',
      );
    }

    this.eventBus.emit(GameEvents.QUEST_COMPLETED, {
      playerId,
      questTemplateId,
      reward: template.rewardJson,
    });

    const socialReward: Record<string, any> = {};
    if (template.rewardSocial?.currencyType) {
      const currencyType = template.rewardSocial.currencyType as CurrencyType;
      if (!QuestService.SOCIAL_CURRENCIES.includes(currencyType)) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '社交奖励货币类型不合法');
      }
      const { balanceAfter } = await this.economyService.addCurrency(
        playerId,
        currencyType,
        template.rewardSocial.amount,
        'quest_reward',
        'quest.submitQuest',
      );
      socialReward[currencyType] = {
        amount: template.rewardSocial.amount,
        balanceAfter,
      };
    }

    // autoReward=true：提交即发主奖励并直接置 CLAIMED；否则置 COMPLETED 待手动领取
    if (template.autoReward) {
      playerQuest.status = QuestStatus.CLAIMED;
      playerQuest.completedAt = new Date();
      playerQuest.completeTimes += 1;
      await this.playerQuestRepo.save(playerQuest);
      await this.deliverReward(playerId, template, playerQuest);
    } else {
      playerQuest.status = QuestStatus.COMPLETED;
      playerQuest.completedAt = new Date();
      await this.playerQuestRepo.save(playerQuest);
    }

    return {
      questId: playerQuest.id,
      reward: template.rewardJson,
      socialReward,
      status: playerQuest.status,
    };
  }

  /** 手动领取（autoReward=false 的任务）：状态原子占位防并发重复领取 */
  async claimQuestReward(
    playerId: string,
    questTemplateId: string,
  ): Promise<SubmitQuestResult> {
    const playerQuest = await this.playerQuestRepo.findOne({
      where: { playerId, questTemplateId },
    });
    if (!playerQuest || playerQuest.status !== QuestStatus.COMPLETED) {
      throw new GameException(
        ErrorCodes.QUEST_NOT_ACCEPTED,
        '任务未完成或已领奖',
      );
    }

    const template = await this.templateRepo.findOne({
      where: { id: questTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.QUEST_NOT_ACCEPTED, '任务模板不存在');
    }

    const claimed = await this.playerQuestRepo.update(
      { id: playerQuest.id, status: QuestStatus.COMPLETED },
      {
        status: QuestStatus.CLAIMED,
        completeTimes: playerQuest.completeTimes + 1,
      },
    );
    if (!claimed.affected) {
      throw new GameException(
        ErrorCodes.QUEST_ALREADY_COMPLETED,
        '奖励已领取',
      );
    }

    try {
      await this.deliverReward(playerId, template, {
        ...playerQuest,
        completeTimes: playerQuest.completeTimes + 1,
      } as PlayerQuest);
    } catch (err) {
      await this.playerQuestRepo.update(
        { id: playerQuest.id },
        { status: QuestStatus.COMPLETED },
      );
      throw err;
    }

    return {
      questId: playerQuest.id,
      reward: template.rewardJson,
      socialReward: {},
      status: QuestStatus.CLAIMED,
    };
  }

  /**
   * 发放任务主奖励。rewardJson 采用扁平键约定：命中 CurrencyType 走经济模块，
   * exp 走玩家经验，未识别键记 warning，避免配置静默失效。
   */
  private async deliverReward(
    playerId: string,
    template: QuestTemplate,
    playerQuest: PlayerQuest,
  ): Promise<void> {
    const reward = template.rewardJson ?? {};
    const supported = Object.values(CurrencyType) as string[];
    const idempotencyKey = `quest_reward:${playerId}:${template.id}:${playerQuest.completeTimes}`;

    for (const [key, raw] of Object.entries(reward)) {
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      if (key === 'exp') {
        await this.playerService.addExp(playerId, amount);
        continue;
      }
      if (supported.includes(key)) {
        await this.economyService.addCurrency(
          playerId,
          key as CurrencyType,
          amount,
          'quest_reward',
          idempotencyKey,
          template.id,
        );
        continue;
      }
      this.logger.warn(
        `Unsupported quest reward key: ${key} (quest=${template.id})`,
      );
    }
  }

  async listPlayerQuests(playerId: string): Promise<QuestWithTemplate[]> {
    const playerQuests = await this.playerQuestRepo.find({
      where: { playerId },
    });
    if (playerQuests.length === 0) return [];

    const results: QuestWithTemplate[] = [];
    for (const pq of playerQuests) {
      const template = await this.templateRepo.findOne({
        where: { id: pq.questTemplateId },
      });
      if (template) {
        results.push({ playerQuest: pq, template });
      }
    }
    return results;
  }

  async updateProgress(
    playerId: string,
    questTemplateId: string,
    progress: number,
  ): Promise<PlayerQuest> {
    const playerQuest = await this.playerQuestRepo.findOne({
      where: { playerId, questTemplateId },
    });
    if (!playerQuest) {
      throw new GameException(ErrorCodes.QUEST_NOT_ACCEPTED, '任务未接取');
    }

    playerQuest.progress = progress;

    const template = await this.templateRepo.findOne({
      where: { id: questTemplateId },
    });
    if (template) {
      const targetCount =
        template.targetJson?.kill_count ?? template.targetJson?.count ?? 0;
      if (targetCount > 0 && progress >= targetCount) {
        playerQuest.status = QuestStatus.COMPLETED;
      }
    }

    return this.playerQuestRepo.save(playerQuest);
  }

  async updateProgressByKill(
    playerId: string,
    monsterTemplateId: string,
  ): Promise<void> {
    const activeQuests = await this.playerQuestRepo.find({
      where: { playerId, status: QuestStatus.IN_PROGRESS },
    });
    for (const quest of activeQuests) {
      const template = await this.templateRepo.findOne({
        where: { id: quest.questTemplateId },
      });
      if (template?.targetJson?.monsterId === monsterTemplateId) {
        quest.progress += 1;
        const targetCount = template.targetJson?.kill_count ?? 0;
        if (targetCount > 0 && quest.progress >= targetCount) {
          quest.status = QuestStatus.COMPLETED;
        }
        await this.playerQuestRepo.save(quest);
      }
    }
  }

  async advanceSocialTarget(
    playerId: string,
    targetType: SocialTargetType,
  ): Promise<void> {
    if (QuestService.ECO_DAILY_LIMITED_TARGETS.includes(targetType)) {
      const dailyKey = `eco:daily:${playerId}:${targetType}`;
      const count = await this.cacheService.incr(dailyKey);
      if (count > QuestService.ECO_DAILY_LIMIT) return;
      await this.cacheService.expire(dailyKey, QuestService.ECO_DAILY_TTL_SECONDS);
    }

    const activeQuests = await this.playerQuestRepo.find({
      where: { playerId, status: QuestStatus.IN_PROGRESS },
    });
    if (activeQuests.length === 0) return;

    for (const quest of activeQuests) {
      const template = await this.templateRepo.findOne({
        where: { id: quest.questTemplateId },
      });
      if (template?.targetType !== targetType) continue;

      // 原子自增：并发事件（如同一秒多个生态回调）各自读-改-写会丢更新，
      // 统一走 UPDATE progress = progress + 1 保证计数不丢失
      await this.playerQuestRepo.increment(
        { id: quest.id, status: QuestStatus.IN_PROGRESS },
        'progress',
        1,
      );
      const targetCount =
        template.targetJson?.count ?? template.targetJson?.kill_count ?? 1;
      if (targetCount > 0) {
        const updated = await this.playerQuestRepo.findOne({
          where: { id: quest.id },
        });
        if (updated && updated.progress >= targetCount) {
          const res = await this.playerQuestRepo.update(
            { id: quest.id, status: QuestStatus.IN_PROGRESS },
            { status: QuestStatus.COMPLETED },
          );
          if (res.affected && res.affected > 0) {
            this.eventBus.emit(GameEvents.QUEST_COMPLETED, {
              playerId,
              questTemplateId: quest.questTemplateId,
              reward: template.rewardJson,
            });
          }
        }
      }
    }
  }

  // ===== 卡关求助 =====

  async requestHelp(
    playerId: string,
    questTemplateId: string,
  ): Promise<QuestHelpRequest> {
    const existing = await this.questHelpRepo.findOne({
      where: { playerId, questTemplateId },
    });
    if (
      existing &&
      (existing.status === QuestHelpStatus.OPEN ||
        existing.status === QuestHelpStatus.HELPED)
    ) {
      throw new GameException(ErrorCodes.QUEST_HELP_EXISTS, '已存在求助请求');
    }

    const request = this.questHelpRepo.create({
      playerId,
      questTemplateId,
      status: QuestHelpStatus.OPEN,
    });
    return this.questHelpRepo.save(request);
  }

  async listHelpRequests(playerId: string): Promise<{
    mine: QuestHelpRequest[];
    open: QuestHelpRequest[];
  }> {
    const [mine, openAll] = await Promise.all([
      this.questHelpRepo.find({
        where: { playerId },
        order: { createdAt: 'DESC' },
      }),
      this.questHelpRepo.find({
        where: { status: QuestHelpStatus.OPEN },
        order: { createdAt: 'DESC' },
      }),
    ]);
    return { mine, open: openAll.filter((r) => r.playerId !== playerId) };
  }

  async respondHelp(
    helperId: string,
    requestId: string,
  ): Promise<QuestHelpRequest> {
    const request = await this.questHelpRepo.findOne({
      where: { id: requestId },
    });
    if (
      !request ||
      request.status === QuestHelpStatus.CLOSED ||
      request.status === QuestHelpStatus.HELPED
    ) {
      throw new GameException(
        ErrorCodes.QUEST_HELP_NOT_FOUND,
        '求助请求不存在或已关闭',
      );
    }
    if (request.playerId === helperId) {
      throw new GameException(
        ErrorCodes.QUEST_HELP_NOT_FOUND,
        '不能协助自己的请求',
      );
    }

    request.status = QuestHelpStatus.HELPED;
    request.helperId = helperId;
    request.helpedAt = new Date();
    const saved = await this.questHelpRepo.save(request);

    const playerQuest = await this.playerQuestRepo.findOne({
      where: {
        playerId: request.playerId,
        questTemplateId: request.questTemplateId,
      },
    });
    if (playerQuest && playerQuest.status === QuestStatus.IN_PROGRESS) {
      const template = await this.templateRepo.findOne({
        where: { id: request.questTemplateId },
      });
      playerQuest.progress += 1;
      const targetCount =
        template?.targetJson?.count ?? template?.targetJson?.kill_count ?? 1;
      if (targetCount > 0 && playerQuest.progress >= targetCount) {
        playerQuest.status = QuestStatus.COMPLETED;
        this.eventBus.emit(GameEvents.QUEST_COMPLETED, {
          playerId: request.playerId,
          questTemplateId: request.questTemplateId,
          reward: template?.rewardJson,
        });
      }
      await this.playerQuestRepo.save(playerQuest);
    }

    await this.economyService.addCurrency(
      helperId,
      CurrencyType.GUILD_CONTRIB,
      10,
      'quest_help',
      'quest.respondHelp',
    );

    return saved;
  }

  // ===== Admin CRUD =====

  async getTemplates(
    page: number,
    limit: number,
  ): Promise<{ items: QuestTemplate[]; total: number }> {
    const [items, total] = await this.templateRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getTemplate(id: string): Promise<QuestTemplate | null> {
    return this.templateRepo.findOne({ where: { id } });
  }

  async createTemplate(data: Partial<QuestTemplate>): Promise<QuestTemplate> {
    const template = this.templateRepo.create(data);
    return this.templateRepo.save(template);
  }

  async updateTemplate(
    id: string,
    data: Partial<QuestTemplate>,
  ): Promise<QuestTemplate | null> {
    const template = await this.templateRepo.findOne({ where: { id } });
    if (!template) return null;
    Object.assign(template, data);
    return this.templateRepo.save(template);
  }
}
