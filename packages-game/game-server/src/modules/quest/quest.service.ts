import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  GuildRole,
  IntelligenceGrade,
  RelationshipLevel,
} from '@constants/enums';
import { CharacterService } from '@modules/character/character.service';
import { SocialService } from '@modules/social/social.service';
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
  private static readonly INTEL_GRADE_RANKS: Record<string, number> = {
    [IntelligenceGrade.E]: 0,
    [IntelligenceGrade.D]: 1,
    [IntelligenceGrade.C]: 2,
    [IntelligenceGrade.B]: 3,
    [IntelligenceGrade.A]: 4,
  };

  private static readonly FAVOR_RANKS: Record<string, number> = {
    [RelationshipLevel.STRANGER]: 0,
    [RelationshipLevel.ACQUAINTANCE]: 1,
    [RelationshipLevel.FRIEND]: 2,
    [RelationshipLevel.CONFIDANT]: 3,
    [RelationshipLevel.SWORN]: 4,
  };

  private static readonly GUILD_ROLE_RANKS: Record<string, number> = {
    [GuildRole.MEMBER]: 0,
    [GuildRole.OFFICER]: 0,
    [GuildRole.ELITE]: 0,
    [GuildRole.INCENSE_MASTER]: 1,
    [GuildRole.HALL_MASTER]: 2,
    [GuildRole.VICE_LEADER]: 3,
    [GuildRole.LEADER]: 4,
  };

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
  ) {}

  async acceptQuest(
    playerId: string,
    questTemplateId: string,
    playerLevel?: number,
  ): Promise<PlayerQuest> {
    const template = await this.templateRepo.findOne({
      where: { id: questTemplateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.QUEST_NOT_ACCEPTED, '任务模板不存在');
    }

    if (playerLevel !== undefined && playerLevel < template.minLevel) {
      throw new GameException(
        ErrorCodes.QUEST_PREREQUISITE_NOT_MET,
        '等级不足',
      );
    }

    if (template.prerequisiteSocial) {
      await this.checkPrerequisiteSocial(playerId, template.prerequisiteSocial);
    }

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
      const required =
        QuestService.INTEL_GRADE_RANKS[prerequisiteSocial.intelGrade] ?? 0;
      const maxRank = intelligences.reduce(
        (max, it) =>
          Math.max(max, QuestService.INTEL_GRADE_RANKS[it.grade] ?? 0),
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
      const required =
        QuestService.FAVOR_RANKS[prerequisiteSocial.favorLevel] ?? 0;
      let maxRank = 0;
      for (const rel of relationships) {
        let rank: number;
        if (rel.level) {
          rank = QuestService.FAVOR_RANKS[rel.level] ?? 0;
        } else {
          const f = rel.favorability;
          rank = f >= 500 ? 4 : f >= 300 ? 3 : f >= 150 ? 2 : f >= 50 ? 1 : 0;
        }
        maxRank = Math.max(maxRank, rank);
      }
      if (maxRank < required) {
        throw new GameException(ErrorCodes.QUEST_SOCIAL_PRE_REQ, '好感档位不足');
      }
    }

    if (prerequisiteSocial.guildRole !== undefined) {
      const required =
        QuestService.GUILD_ROLE_RANKS[prerequisiteSocial.guildRole] ?? 0;
      const roleRank = myGuildRole
        ? QuestService.GUILD_ROLE_RANKS[myGuildRole.role] ?? 0
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
    if (
      !playerQuest ||
      (playerQuest.status !== QuestStatus.IN_PROGRESS &&
        playerQuest.status !== QuestStatus.COMPLETED)
    ) {
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

    playerQuest.status = QuestStatus.CLAIMED;
    playerQuest.completedAt = new Date();
    playerQuest.completeTimes += 1;
    await this.playerQuestRepo.save(playerQuest);

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

    return {
      questId: playerQuest.id,
      reward: template.rewardJson,
      socialReward,
      status: QuestStatus.CLAIMED,
    };
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
