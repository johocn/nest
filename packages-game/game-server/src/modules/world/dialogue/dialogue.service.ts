import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestStatus } from '@constants/enums';
import { CacheService } from '@cache/cache.service';
import { PlayerService } from '@modules/player/player.service';
import { PlayerQuest } from '@modules/quest/entities/player-quest.entity';
import { InventoryItem } from '@modules/inventory/entities/inventory-item.entity';
import { DialogueContext } from './dialogue.resolver';

/**
 * 对话服务（S5）。
 *
 * 本 Task 只负责「组装玩家上下文」：把等级/任务态/背包数量/redis 旗标读成纯数据结构，
 * 供纯函数解析器 dialogue.resolver 使用。
 *
 * 预留抛出点（Task 3/4 实现，本批暂不新增错误码）：
 *  - 取不到对话（code/dialogueId 悬空）→ DIALOGUE_NOT_FOUND（计划 §3 风险 #4）；
 *  - 节点级/选项级条件不满足 → DIALOGUE_CONDITION_NOT_MET；
 *  - 动作执行失败 → 复用既有业务码并**不推进节点**（计划 §1.3 D3）。
 */

/** redis 旗标键前缀：dialogue:flag:<playerId>:<flag> */
export const DIALOGUE_FLAG_PREFIX = 'dialogue:flag:';

@Injectable()
export class DialogueService {
  private readonly logger = new Logger(DialogueService.name);

  constructor(
    @InjectRepository(PlayerQuest)
    private readonly playerQuestRepo: Repository<PlayerQuest>,
    @InjectRepository(InventoryItem)
    private readonly inventoryItemRepo: Repository<InventoryItem>,
    private readonly playerService: PlayerService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * 组装玩家上下文（并发读，不连写）。
   *
   * 旗标说明：本批**没有旗标索引**，无法枚举某玩家的全部旗标，因此由调用方传入
   * `neededFlags`（通常来自 `collectFlagKeys(nodes)`），逐个探测存在性；只放入存在的旗标。
   */
  async buildContext(
    playerId: string,
    neededFlags: string[] = [],
  ): Promise<DialogueContext> {
    const [level, quests, items, flags] = await Promise.all([
      this.getPlayerLevel(playerId),
      this.playerQuestRepo.find({ where: { playerId } }),
      this.inventoryItemRepo.find({ where: { playerId } }),
      this.loadFlags(playerId, neededFlags),
    ]);

    const questStatus = new Map<string, QuestStatus>();
    for (const quest of quests) {
      questStatus.set(String(quest.questTemplateId), quest.status);
    }

    const itemCount = new Map<string, number>();
    for (const item of items) {
      const id = String(item.itemTemplateId);
      const quantity = Number(item.quantity);
      itemCount.set(
        id,
        (itemCount.get(id) ?? 0) + (Number.isFinite(quantity) ? quantity : 0),
      );
    }

    return { level, questStatus, itemCount, flags };
  }

  /** 读取玩家等级；玩家不存在或读失败时按「无等级」处理（与 S4 一致） */
  private async getPlayerLevel(playerId: string): Promise<number> {
    try {
      const player = await this.playerService.getById(playerId);
      return player && Number.isFinite(player.level) ? player.level : 0;
    } catch (err) {
      this.logger.warn(`读取玩家 ${playerId} 等级失败：${String(err)}`);
      return 0;
    }
  }

  /** 逐个探测旗标存在性，只返回**存在**的旗标 */
  private async loadFlags(
    playerId: string,
    neededFlags: string[],
  ): Promise<Set<string>> {
    const flags = new Set<string>();
    const unique = Array.from(
      new Set(
        neededFlags.filter((f) => typeof f === 'string' && f.trim() !== ''),
      ),
    );
    if (unique.length === 0) return flags;

    const probed = await Promise.all(
      unique.map(async (flag) => ({
        flag,
        exists: await this.cacheService.exists(this.flagKey(playerId, flag)),
      })),
    );
    for (const item of probed) {
      if (item.exists) flags.add(item.flag);
    }
    return flags;
  }

  /** 旗标 redis 键：dialogue:flag:<playerId>:<flag> */
  private flagKey(playerId: string, flag: string): string {
    return `${DIALOGUE_FLAG_PREFIX}${playerId}:${flag}`;
  }
}
