import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GuideProgress } from './entities';
import { SocialEconomyService } from './social-economy.service';
import { PlayerService } from '@modules/player/player.service';
import { ConfigManageService } from '@modules/config/config.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  GuideTaskStatus,
  SocialPointReason,
  CurrencyType,
} from '@constants/enums';
import { EconomyService } from '@modules/economy/economy.service';

const GUIDE: Record<
  number,
  { title: string; tasks: Array<{ id: string; desc: string }> }
> = {
  1: { title: '寻师问路', tasks: [{ id: 'kinship', desc: '缔结一段师徒或结义亲缘' }] },
  2: { title: '以武会友', tasks: [{ id: 'friend', desc: '添加 1 位好友' }] },
  3: { title: '初涉江湖', tasks: [{ id: 'intel', desc: '获取 1 条情报（刺探/打听/窃听）' }] },
  4: { title: '立帮兴业', tasks: [{ id: 'guild', desc: '加入或创建帮派' }] },
  5: { title: '行商走镖', tasks: [{ id: 'escort', desc: '完成 1 次运镖或悬赏' }] },
  6: { title: '礼尚往来', tasks: [{ id: 'gift', desc: '送出 1 份礼物并获得回礼' }] },
  7: { title: '桃园之义', tasks: [{ id: 'sworn', desc: '完成结义或正式拜师' }] },
  8: { title: '日常循环', tasks: [{ id: 'daily', desc: '每日任务与帮派活动循环' }] },
};

@Injectable()
export class SocialGuideService {
  constructor(
    @InjectRepository(GuideProgress)
    private readonly guideRepo: Repository<GuideProgress>,
    private readonly economyService: SocialEconomyService,
    private readonly playerService: PlayerService,
    private readonly configService: ConfigManageService,
    private readonly eventBus: EventBusService,
    private readonly currencyService: EconomyService,
  ) {}

  private async registerDay(playerId: string): Promise<number> {
    const player = await this.playerService.getById(playerId);
    const createdAt = player?.createdAt ?? new Date();
    return Math.min(
      Math.floor((Date.now() - createdAt.getTime()) / (24 * 3600 * 1000)) + 1,
      8,
    );
  }

  async completeTask(playerId: string, taskId: string): Promise<void> {
    const existing = await this.guideRepo.findOne({ where: { playerId, taskId } });
    if (existing) return; // 已完成（DONE/REWARDED）不重复推进
    const day = await this.registerDay(playerId);
    if (day >= 8) return; // 老玩家日常循环不追踪
    await this.guideRepo.save(
      this.guideRepo.create({
        playerId,
        day,
        taskId,
        status: GuideTaskStatus.DONE,
        completedAt: new Date(),
        claimedAt: null,
      }),
    );
    this.eventBus.emit(GameEvents.GUIDE_TASK_COMPLETED, { playerId, taskId, day });
  }

  async getDailyGuide(playerId: string): Promise<{
    day: number;
    title: string;
    tasks: Array<{ id: string; desc: string; done: boolean; rewarded: boolean }>;
    rewardReady: boolean;
  }> {
    const day = await this.registerDay(playerId);
    const progresses = await this.guideRepo.find({ where: { playerId } });
    const map = new Map(progresses.map((p) => [p.taskId, p]));

    const current = GUIDE[day];
    const tasks = current.tasks.map((t) => {
      const p = map.get(t.id);
      return {
        id: t.id,
        desc: t.desc,
        done: p?.status === GuideTaskStatus.DONE || p?.status === GuideTaskStatus.REWARDED,
        rewarded: p?.status === GuideTaskStatus.REWARDED,
      };
    });

    return {
      day,
      title: current.title,
      tasks,
      rewardReady: tasks.some((t) => t.done && !t.rewarded),
    };
  }

  async claimTaskReward(
    playerId: string,
    taskId: string,
  ): Promise<{ taskId: string; points: number; gold: number }> {
    const progress = await this.guideRepo.findOne({ where: { playerId, taskId } });
    if (!progress || progress.status === GuideTaskStatus.TODO) {
      throw new GameException(ErrorCodes.GUIDE_TASK_NOT_DONE, '任务未完成不可领奖');
    }
    if (progress.status === GuideTaskStatus.REWARDED) {
      throw new GameException(ErrorCodes.GUIDE_REWARD_CLAIMED, '奖励已领取');
    }
    const points = await this.economyService.earnPoints(
      playerId,
      20,
      SocialPointReason.GUIDE_TASK,
      `guide:${taskId}`,
    );
    const gold = 50;
    await this.currencyService.addCurrency(
      playerId,
      CurrencyType.GOLD,
      gold,
      'guide_reward',
      `guide:${taskId}`,
    );
    if (taskId === 'sworn') {
      const milestone = await this.readConfigNumber('guide.milestone_reward', 50);
      await this.currencyService.addCurrency(
        playerId,
        CurrencyType.DIAMOND,
        milestone,
        'guide_milestone',
        `guide:${taskId}`,
      );
    }
    progress.status = GuideTaskStatus.REWARDED;
    progress.claimedAt = new Date();
    await this.guideRepo.save(progress);
    return { taskId, points: points ?? 20, gold };
  }

  private async readConfigNumber(key: string, fallback: number): Promise<number> {
    try {
      const config = await this.configService.getConfig(key);
      return Number(config.value) || fallback;
    } catch {
      return fallback;
    }
  }
}
