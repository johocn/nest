import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrencyType, DialogueActionType, QuestStatus } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import { CacheService } from '@cache/cache.service';
import { PlayerService } from '@modules/player/player.service';
import { PlayerQuest } from '@modules/quest/entities/player-quest.entity';
import { QuestService } from '@modules/quest/quest.service';
import { InventoryItem } from '@modules/inventory/entities/inventory-item.entity';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { Dialogue } from '../entities/dialogue.entity';
import {
  DialogueContext,
  ResolvedNode,
  collectFlagKeys,
  matchCondition,
  resolveNode,
} from './dialogue.resolver';
import {
  DialogueActionArgs,
  DialogueNode,
  assertDialogueNodes,
} from './dialogue.types';

/**
 * 对话服务（S5）。
 *
 * 职责：
 *  1. 组装玩家上下文（buildContext）：等级/任务态/背包数量/redis 旗标 → 纯数据结构；
 *  2. 动作执行器（executeAction）：6 个白名单动作**一律走既有服务**，失败即中止不推进节点（D3）；
 *  3. 对话推进（start / choose）：服务端权威解析节点、条件过滤、防重放（D2/D4/D7）。
 *
 * 错误语义（计划 §1.2/§3）：
 *  - 取不到对话（code 悬空 / 已停用）→ DIALOGUE_NOT_FOUND；
 *  - 节点/选项条件不满足 → DIALOGUE_CONDITION_NOT_MET；
 *  - 节点不在树内 / 选项越界 / 动作未白名单 → DIALOGUE_NODE_INVALID；
 *  - 动作失败（如背包满）→ 原样上抛既有业务码，**不推进节点**。
 */

/** redis 旗标键前缀：dialogue:flag:<playerId>:<flag> */
export const DIALOGUE_FLAG_PREFIX = 'dialogue:flag:';

/** choose 入参（Task 4 的 DTO 会直接映射到该形状） */
export interface ChooseDialogueInput {
  code: string;
  nodeKey: string;
  optionIndex: number;
}

/** 下发给客户端的对话视图（start / choose 共用） */
export interface DialogueView {
  code: string;
  nodeKey: string | null;
  node: ResolvedNode | null;
  finished: boolean;
}

@Injectable()
export class DialogueService {
  private readonly logger = new Logger(DialogueService.name);

  constructor(
    @InjectRepository(PlayerQuest)
    private readonly playerQuestRepo: Repository<PlayerQuest>,
    @InjectRepository(InventoryItem)
    private readonly inventoryItemRepo: Repository<InventoryItem>,
    @InjectRepository(Dialogue)
    private readonly dialogueRepo: Repository<Dialogue>,
    private readonly playerService: PlayerService,
    private readonly cacheService: CacheService,
    private readonly questService: QuestService,
    private readonly inventoryService: InventoryService,
    private readonly economyService: EconomyService,
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

  // ===== 对话推进（服务端权威）=====

  /**
   * 打开对话：返回首节点视图（Task 4 的 talk 会委托此方法）。
   * 校验：对话存在且 isActive、结构合法、首节点条件满足。
   */
  async start(playerId: string, dialogueCode: string): Promise<DialogueView> {
    const dialogue = await this.findActiveDialogue(dialogueCode);
    const nodes = this.assertNodes(dialogue);

    const ctx = await this.buildContext(playerId, collectFlagKeys(nodes));
    const first = nodes[0];
    const node = resolveNode(nodes, first.key, ctx);
    if (!node) {
      throw new GameException(
        ErrorCodes.DIALOGUE_CONDITION_NOT_MET,
        `首节点当前不可进入：${first.key}`,
      );
    }
    return { code: dialogue.code, nodeKey: node.key, node, finished: false };
  }

  /**
   * 选择某个选项并推进（D2/D4/D7）。
   *
   * 严格顺序（计划 §2 Task 3 Step 3）：
   *  1. 按 code 查 isActive 对话 → 不存在/停用 → DIALOGUE_NOT_FOUND；
   *  2. 结构校验 → 非法 → DIALOGUE_NODE_INVALID；
   *  3. 组装玩家上下文；
   *  4. nodeKey 必须属于该树（D7：无持久会话，靠 code+nodeKey 定位）；
   *  5. 节点级条件不满足 → DIALOGUE_CONDITION_NOT_MET；
   *  6. 取**原始** options[optionIndex]，越界 → DIALOGUE_NODE_INVALID；
   *  7. 对该选项 condition 重新求值（防重放：客户端看不到隐藏选项，服务端二次把关）；
   *  8. 执行动作（失败即中止，**不推进**）；
   *  9. 动作可能改变任务/道具状态 → 重新组装上下文再解析 next 节点。
   */
  async choose(
    playerId: string,
    input: ChooseDialogueInput,
  ): Promise<DialogueView> {
    const dialogue = await this.findActiveDialogue(input.code);
    const nodes = this.assertNodes(dialogue);

    const ctx = await this.buildContext(playerId, collectFlagKeys(nodes));

    const node = nodes.find((n) => n.key === input.nodeKey);
    if (!node) {
      throw new GameException(
        ErrorCodes.DIALOGUE_NODE_INVALID,
        `节点不属于该对话树：${input.nodeKey}`,
      );
    }
    if (!matchCondition(node.condition, ctx)) {
      throw new GameException(
        ErrorCodes.DIALOGUE_CONDITION_NOT_MET,
        `节点条件不满足：${node.key}`,
      );
    }

    const option = node.options[input.optionIndex];
    if (!option) {
      throw new GameException(
        ErrorCodes.DIALOGUE_NODE_INVALID,
        `选项下标越界：${input.optionIndex}`,
      );
    }
    if (!matchCondition(option.condition, ctx)) {
      throw new GameException(
        ErrorCodes.DIALOGUE_CONDITION_NOT_MET,
        '该选项当前不可选',
      );
    }

    const opTrace = `dialogue:choose:${dialogue.code}:${node.key}`;
    if (option.action) {
      await this.executeAction(
        playerId,
        option.action,
        option.actionArgs ?? {},
        opTrace,
      );
    }

    // option.next 为空 → 对话结束
    if (!option.next) {
      return { code: dialogue.code, nodeKey: null, node: null, finished: true };
    }

    // 动作已改变玩家状态（如刚接任务），必须重新求值 next 节点的可见性
    const newCtx = await this.buildContext(playerId, collectFlagKeys(nodes));
    const nextNode = resolveNode(nodes, option.next, newCtx);
    if (!nextNode) {
      // 不返回 finished，避免把「配置错误/条件未满足」伪装成正常结束
      throw new GameException(
        ErrorCodes.DIALOGUE_CONDITION_NOT_MET,
        `下一节点当前不可进入：${option.next}`,
      );
    }
    return {
      code: dialogue.code,
      nodeKey: nextNode.key,
      node: nextNode,
      finished: false,
    };
  }

  /**
   * 执行单个对话动作（计划 §1.4 白名单 6 个）。
   *
   * 硬约束：**一律走既有服务**（QuestService / InventoryService / EconomyService / redis 旗标），
   * 不在对话模块内写第二套经济或背包逻辑。
   *
   * 失败即中止（D3）：GameException 原样上抛（HTTP 200 + 业务码），调用方据此**不推进节点**；
   * 非 GameException 的意外异常记日志后包装为 INTERNAL_ERROR 抛出，同样不推进。
   */
  async executeAction(
    playerId: string,
    action: DialogueActionType,
    args: DialogueActionArgs = {},
    opTrace?: string,
  ): Promise<void> {
    const trace =
      opTrace && opTrace.trim() !== ''
        ? opTrace
        : `dialogue:action:${action}`;
    try {
      await this.dispatchAction(playerId, action, args ?? {}, trace);
    } catch (err) {
      if (err instanceof GameException) throw err; // 原样上抛，不吞
      this.logger.error(
        `对话动作 ${action} 执行异常（player=${playerId}）：${String(err)}`,
      );
      throw new GameException(
        ErrorCodes.INTERNAL_ERROR,
        `对话动作执行失败：${action}`,
      );
    }
  }

  /** 动作分派（参数缺失/非法 → PARAM_INVALID；未白名单 → DIALOGUE_NODE_INVALID） */
  private async dispatchAction(
    playerId: string,
    action: DialogueActionType,
    args: DialogueActionArgs,
    opTrace: string,
  ): Promise<void> {
    switch (action) {
      case DialogueActionType.ACCEPT_QUEST: {
        const questTemplateId = this.requireString(args, 'questTemplateId', action);
        await this.questService.acceptQuest(playerId, questTemplateId);
        return;
      }
      case DialogueActionType.SUBMIT_QUEST: {
        const questTemplateId = this.requireString(args, 'questTemplateId', action);
        await this.questService.submitQuest(playerId, questTemplateId);
        return;
      }
      case DialogueActionType.GIVE_ITEM: {
        const itemTemplateId = this.requireString(args, 'itemTemplateId', action);
        const quantity = this.optionalQuantity(args.quantity, action);
        await this.inventoryService.addItem(
          playerId,
          itemTemplateId,
          quantity,
          opTrace,
        );
        return;
      }
      case DialogueActionType.TAKE_ITEM: {
        const itemTemplateId = this.requireString(args, 'itemTemplateId', action);
        const quantity = this.optionalQuantity(args.quantity, action);
        await this.inventoryService.removeItem(
          playerId,
          itemTemplateId,
          quantity,
          opTrace,
        );
        return;
      }
      case DialogueActionType.ADD_CURRENCY: {
        const currencyType = this.requireString(args, 'currencyType', action);
        const amount = this.requirePositiveNumber(args, 'amount', action);
        await this.economyService.addCurrency(
          playerId,
          currencyType as CurrencyType,
          amount,
          'dialogue',
          opTrace,
        );
        return;
      }
      case DialogueActionType.SET_FLAG: {
        const flag = this.requireString(args, 'flag', action);
        await this.cacheService.set(this.flagKey(playerId, flag), '1');
        return;
      }
      default:
        throw new GameException(
          ErrorCodes.DIALOGUE_NODE_INVALID,
          `未知对话动作「${String(action)}」`,
        );
    }
  }

  /** 取必填字符串参数；缺失/非法 → PARAM_INVALID（不静默跳过） */
  private requireString(
    args: DialogueActionArgs,
    key: keyof DialogueActionArgs,
    action: string,
  ): string {
    const raw = args?.[key];
    const value = typeof raw === 'number' ? String(raw) : raw;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `对话动作「${action}」缺少参数 ${key}`,
      );
    }
    return value;
  }

  /** 取必填正数参数；缺失/非正 → PARAM_INVALID */
  private requirePositiveNumber(
    args: DialogueActionArgs,
    key: keyof DialogueActionArgs,
    action: string,
  ): number {
    const value = Number(args?.[key]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `对话动作「${action}」参数 ${key} 必须是正数`,
      );
    }
    return value;
  }

  /** 数量：缺省为 1，非法 → PARAM_INVALID */
  private optionalQuantity(raw: unknown, action: string): number {
    if (raw === undefined || raw === null) return 1;
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `对话动作「${action}」参数 quantity 必须是正数`,
      );
    }
    return Math.floor(quantity);
  }

  /** 查启用中的对话；不存在/停用 → DIALOGUE_NOT_FOUND（业务码而非 500） */
  private async findActiveDialogue(code: string): Promise<Dialogue> {
    const dialogue = await this.dialogueRepo.findOne({
      where: { code, isActive: true },
    });
    if (!dialogue) {
      throw new GameException(
        ErrorCodes.DIALOGUE_NOT_FOUND,
        `对话不存在或已停用：${code}`,
      );
    }
    return dialogue;
  }

  /** 结构校验；非法 → DIALOGUE_NODE_INVALID（错误信息带上全部问题） */
  private assertNodes(dialogue: Dialogue): DialogueNode[] {
    const asserted = assertDialogueNodes(dialogue.nodes);
    if (!asserted.ok) {
      throw new GameException(
        ErrorCodes.DIALOGUE_NODE_INVALID,
        `对话结构非法：${asserted.errors.join('；')}`,
      );
    }
    return asserted.nodes;
  }
}
