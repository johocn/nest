import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestTemplate, PlayerQuest } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { QuestStatus } from '@constants/enums';

export interface QuestWithTemplate {
  playerQuest: PlayerQuest;
  template: QuestTemplate;
}

export interface SubmitQuestResult {
  questId: string;
  reward: Record<string, any>;
  status: QuestStatus;
}

@Injectable()
export class QuestService {
  constructor(
    @InjectRepository(QuestTemplate)
    private readonly templateRepo: Repository<QuestTemplate>,
    @InjectRepository(PlayerQuest)
    private readonly playerQuestRepo: Repository<PlayerQuest>,
    private readonly eventBus: EventBusService,
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

    return {
      questId: playerQuest.id,
      reward: template.rewardJson,
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
