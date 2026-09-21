import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Scene,
  NpcTemplate,
  MonsterTemplate,
  ObjectTemplate,
  SceneTrigger,
  SceneEntitySpawn,
  TriggerUnlock,
  PlayerMount,
  StreetGame,
  GameSession,
  LandmarkMessage,
} from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import {
  SceneStatus,
  ObjectType,
  InteractType,
  TriggerType,
  GameSessionStatus,
  CurrencyType,
  EntityType,
  NpcInteractType,
} from '@constants/enums';
import { EconomyService } from '../economy/economy.service';
import { ResourceBalancePolicy } from './resource-balance.policy';
import {
  NpcPresenceService,
  NpcInstance,
} from './npc/npc-presence.service';

/** 活跃场景登记键（S4：只跑有玩家在场的场景，D7） */
export const ACTIVE_SCENES_KEY = 'scenes:active';

export interface SceneEnterResult {
  scene: Scene;
  spawns: SceneEntitySpawn[];
  triggers: SceneTrigger[];
  /** 该玩家在此场景可见的 NPC 实例（S4，新增字段，旧字段零变更） */
  npcs: NpcInstance[];
}

export interface NpcTalkResult {
  spawnId: string;
  npcTemplateId: string;
  name: string;
  talkType: NpcInteractType;
  dialogueId: number | null;
  text: string;
  options: Array<{ text: string; next: string | null }>;
}

@Injectable()
export class WorldService {
  constructor(
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(NpcTemplate)
    private readonly npcRepo: Repository<NpcTemplate>,
    @InjectRepository(MonsterTemplate)
    private readonly monsterRepo: Repository<MonsterTemplate>,
    @InjectRepository(ObjectTemplate)
    private readonly objRepo: Repository<ObjectTemplate>,
    @InjectRepository(SceneTrigger)
    private readonly triggerRepo: Repository<SceneTrigger>,
    @InjectRepository(SceneEntitySpawn)
    private readonly spawnRepo: Repository<SceneEntitySpawn>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
    private readonly economyService: EconomyService,
    @InjectRepository(TriggerUnlock)
    private readonly triggerUnlockRepo: Repository<TriggerUnlock>,
    @InjectRepository(PlayerMount)
    private readonly mountRepo: Repository<PlayerMount>,
    @InjectRepository(StreetGame)
    private readonly gameRepo: Repository<StreetGame>,
    @InjectRepository(GameSession)
    private readonly sessionRepo: Repository<GameSession>,
    @InjectRepository(LandmarkMessage)
    private readonly landmarkMsgRepo: Repository<LandmarkMessage>,
    private readonly npcPresence: NpcPresenceService,
  ) {}

  async getScene(id: string): Promise<Scene> {
    const scene = await this.sceneRepo.findOne({ where: { id } });
    if (!scene) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '场景不存在');
    }
    return scene;
  }

  async getScenes(
    page: number,
    limit: number,
  ): Promise<{ items: Scene[]; total: number }> {
    const [items, total] = await this.sceneRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async createScene(data: Partial<Scene>): Promise<Scene> {
    const scene = this.sceneRepo.create(data);
    return this.sceneRepo.save(scene);
  }

  async updateScene(id: string, data: Partial<Scene>): Promise<Scene> {
    const scene = await this.sceneRepo.findOne({ where: { id } });
    if (!scene) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '场景不存在');
    }
    Object.assign(scene, data);
    return this.sceneRepo.save(scene);
  }

  async getSceneSpawns(sceneId: string): Promise<SceneEntitySpawn[]> {
    return this.spawnRepo.find({ where: { sceneId, isActive: true } });
  }

  async getSceneTriggers(sceneId: string): Promise<SceneTrigger[]> {
    return this.triggerRepo.find({ where: { sceneId } });
  }

  async checkEnterRequirement(
    sceneId: string,
    playerLevel: number,
  ): Promise<void> {
    const scene = await this.getScene(sceneId);
    if (scene.status === SceneStatus.MAINTENANCE) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        '场景维护中，暂不可进入',
      );
    }
    if (playerLevel < scene.minLevel) {
      throw new GameException(
        ErrorCodes.LEVEL_NOT_ENOUGH,
        '等级不足，无法进入该场景',
        {
          required: scene.minLevel,
          current: playerLevel,
        },
      );
    }
  }

  async enterScene(
    playerId: string,
    sceneId: string,
  ): Promise<SceneEnterResult> {
    const scene = await this.getScene(sceneId);
    const spawns = await this.getSceneSpawns(sceneId);
    const triggers = await this.getSceneTriggers(sceneId);
    // S4：按该玩家的 condition 过滤后下发 NPC 实例（位置/路点由服务端权威给出）
    const npcs = await this.npcPresence.listNpcsForPlayer(sceneId, playerId);
    await this.cacheService.sAdd(`scene:${sceneId}:players`, playerId);
    // S4：登记活跃场景，供 NPC tick 只跑有玩家在场的场景（D7）
    await this.cacheService.sAdd(ACTIVE_SCENES_KEY, String(sceneId));
    this.eventBus.emit(GameEvents.PLAYER_ENTER_SCENE, { playerId, sceneId });
    return { scene, spawns, triggers, npcs };
  }

  async leaveScene(playerId: string, sceneId: string): Promise<void> {
    await this.cacheService.sRem(`scene:${sceneId}:players`, playerId);
    // S4：场景内最后一名玩家离开时摘除活跃标记，空场景不再空转（D7）
    const remaining = await this.cacheService.sMembers(
      `scene:${sceneId}:players`,
    );
    if (remaining.length === 0) {
      await this.cacheService.sRem(ACTIVE_SCENES_KEY, sceneId);
    }
    this.eventBus.emit(GameEvents.PLAYER_LEAVE_SCENE, { playerId, sceneId });
  }

  async getScenePlayers(sceneId: string): Promise<string[]> {
    return this.cacheService.sMembers(`scene:${sceneId}:players`);
  }

  async getNpcTemplate(id: string): Promise<NpcTemplate | null> {
    return this.npcRepo.findOne({ where: { id } });
  }

  async getMonsterTemplate(id: string): Promise<MonsterTemplate | null> {
    return this.monsterRepo.findOne({ where: { id } });
  }

  async getObjectTemplate(id: string): Promise<ObjectTemplate | null> {
    return this.objRepo.findOne({ where: { id } });
  }

  /**
   * NPC 对话（S1 最小实现）：
   * - spawnId 是 scene_entity_spawns.id
   * - 文案先取 npc_templates.attr.greeting；S5 接入 dialogues 表后改为按 dialogueId 返回节点树
   * - playerId 目前仅用于后续「按任务状态过滤/对话 CD」，S1 不产生副作用
   */
  async talkNpc(playerId: string, spawnId: string): Promise<NpcTalkResult> {
    const spawn = await this.spawnRepo.findOne({ where: { id: spawnId } });
    if (!spawn || spawn.entityType !== EntityType.NPC) {
      throw new GameException(ErrorCodes.PARAM_INVALID, 'NPC 不存在');
    }

    const template = await this.npcRepo.findOne({
      where: { id: spawn.templateId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.PARAM_INVALID, 'NPC 模板不存在');
    }
    if (template.interactType !== NpcInteractType.TALK) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '该 NPC 当前无法对话');
    }

    const attr = (template.attr ?? {}) as Record<string, any>;
    const greeting = typeof attr.greeting === 'string' ? attr.greeting : '';

    return {
      spawnId: spawn.id,
      npcTemplateId: template.id,
      name: template.name,
      talkType: template.interactType,
      dialogueId: template.dialogueId ?? null,
      text: greeting || `${template.name}：……`,
      options: Array.isArray(attr.options) ? attr.options : [],
    };
  }

  async interactObject(
    playerId: string,
    objectId: string,
    interactType: InteractType,
  ): Promise<{ ok: boolean; reward?: any }> {
    const obj = await this.objRepo.findOne({ where: { id: objectId } });
    if (!obj) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '物件不存在');
    }

    // 冷却校验（interactCd>0 时用 redis SET NX EX）
    if (obj.interactCd > 0) {
      const cdKey = `world:obj:cd:${objectId}:${playerId}`;
      const cdOk = await this.cacheService.acquireLock(cdKey, obj.interactCd);
      if (!cdOk) {
        throw new GameException(ErrorCodes.OBJECT_COOLDOWN, '物件冷却中');
      }
    }

    // 一次性校验
    if (obj.isOneTime) {
      const onceKey = `world:obj:once:${objectId}`;
      const first = await this.cacheService.acquireLock(onceKey, 31536000);
      if (!first) {
        throw new GameException(ErrorCodes.OBJECT_ALREADY_OPENED, '该物件已被开启');
      }
    }

    // 奖励发放（支持 { type:'currency', currencyType, amount }）
    const reward = obj.reward;
    if (reward && reward.type === 'currency') {
      let amount = Number(reward.amount);
      if (
        obj.type === ObjectType.COLLECT ||
        obj.type === ObjectType.STONE ||
        obj.type === ObjectType.PLANT
      ) {
        const policy = new ResourceBalancePolicy();
        const dateKey = new Date().toISOString().slice(0, 10);
        const harvestKey = `world:harvest:${playerId}:${dateKey}`;
        const seqKey = `world:seq:${objectId}`;
        const [harvestCount, seqCount] = await Promise.all([
          this.cacheService.get(harvestKey),
          this.cacheService.get(seqKey),
        ]);
        const harvestN = Number(harvestCount ?? '0');
        const seqN = Number(seqCount ?? '0');
        amount = Math.floor(
          policy.degradedYield(amount, seqN) *
            policy.efficiencyFactor(harvestN + 1),
        );
        await this.cacheService.set(harvestKey, String(harvestN + 1));
        await this.cacheService.set(seqKey, String(seqN + 1));
        if (seqN === 0) {
          await this.cacheService.expire(seqKey, 6 * 3600);
        }
      }
      await this.economyService.addCurrency(
        playerId,
        reward.currencyType as CurrencyType,
        amount,
        'object',
        `object:${objectId}:${interactType}`,
        objectId,
      );
      return { ok: true, reward: { currencyType: reward.currencyType, amount } };
    }

    return { ok: true };
  }

  async activateTrigger(
    playerId: string,
    triggerId: string,
    memberIds: string[] = [],
  ): Promise<{ unlocked: boolean; members: string[] }> {
    const trigger = await this.triggerRepo.findOne({
      where: { id: triggerId },
    });
    if (!trigger) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '机关不存在');
    }
    if (
      trigger.triggerType !== TriggerType.PUZZLE &&
      trigger.triggerType !== TriggerType.GATE &&
      trigger.triggerType !== TriggerType.TRAP
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '该触发器非机关类型');
    }
    const required = trigger.condition?.requiredPlayers ?? 1;
    const members = [playerId, ...memberIds.filter((m) => m !== playerId)];
    if (members.length < required) {
      throw new GameException(
        ErrorCodes.TRIGGER_NOT_READY,
        `机关需要 ${required} 人配合，当前 ${members.length} 人`,
      );
    }
    const records = members.map((pid) =>
      this.triggerUnlockRepo.create({ triggerId, playerId: pid }),
    );
    await this.triggerUnlockRepo.save(records);
    return { unlocked: true, members };
  }

  async equipMount(
    characterId: string,
    mountId: string,
  ): Promise<{ ok: boolean }> {
    const existing = await this.mountRepo.findOne({
      where: { characterId, mountId },
    });
    if (existing) {
      await this.mountRepo.update(
        { characterId, isActive: true },
        { isActive: false },
      );
      existing.isActive = true;
      await this.mountRepo.save(existing);
      return { ok: true };
    }
    const mount = this.mountRepo.create({
      characterId,
      mountId,
      isActive: true,
    });
    await this.mountRepo.save(mount);
    return { ok: true };
  }

  async rideMount(
    characterId: string,
    mountId: string,
    ride: boolean,
  ): Promise<{ ok: boolean }> {
    const existing = await this.mountRepo.findOne({
      where: { characterId, mountId },
    });
    if (!existing) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '坐骑未获得');
    }
    await this.mountRepo.update(
      { id: existing.id },
      { isActive: ride },
    );
    return { ok: true };
  }

  async startGame(
    playerId: string,
    gameId: string,
    betAmount: number,
  ): Promise<GameSession> {
    const game = await this.gameRepo.findOne({ where: { id: gameId } });
    if (!game) {
      throw new GameException(ErrorCodes.GAME_NOT_FOUND, '玩法不存在');
    }
    const range = game.betRange ?? { min: 10, max: 1000 };
    if (betAmount < range.min || betAmount > range.max) {
      throw new GameException(ErrorCodes.BET_INVALID, '下注金额超出范围');
    }
    await this.economyService.deductCurrency(
      playerId,
      CurrencyType.GOLD,
      betAmount,
      'street_game',
      `game:${gameId}:start`,
      gameId,
    );
    const session = this.sessionRepo.create({
      gameId,
      hostPlayerId: playerId,
      status: GameSessionStatus.OPEN,
      betPool: betAmount.toString(),
    });
    return this.sessionRepo.save(session);
  }

  async betGame(
    playerId: string,
    sessionId: string,
    betAmount: number,
  ): Promise<{ betPool: string }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new GameException(ErrorCodes.GAME_NOT_FOUND, '对局不存在');
    }
    if (session.status !== GameSessionStatus.OPEN) {
      throw new GameException(ErrorCodes.GAME_NOT_OPEN, '对局已开始或已结束');
    }
    const game = await this.gameRepo.findOne({
      where: { id: session.gameId },
    });
    const range = game?.betRange ?? { min: 10, max: 1000 };
    if (betAmount < range.min || betAmount > range.max) {
      throw new GameException(ErrorCodes.BET_INVALID, '下注金额超出范围');
    }
    await this.economyService.deductCurrency(
      playerId,
      CurrencyType.GOLD,
      betAmount,
      'street_game_bet',
      `session:${sessionId}:bet`,
      sessionId,
    );
    session.betPool = (
      BigInt(session.betPool) + BigInt(betAmount)
    ).toString();
    await this.sessionRepo.save(session);
    return { betPool: session.betPool };
  }

  async finishGame(
    playerId: string,
    sessionId: string,
    winnerPlayerId: string,
  ): Promise<{ winner: string; payout: string }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new GameException(ErrorCodes.GAME_NOT_FOUND, '对局不存在');
    }
    if (session.hostPlayerId !== playerId) {
      throw new GameException(ErrorCodes.FORBIDDEN, '只有房主可结算');
    }
    if (session.status === GameSessionStatus.FINISHED) {
      throw new GameException(ErrorCodes.GAME_NOT_OPEN, '对局已结束');
    }
    const pool = BigInt(session.betPool);
    const payout = (pool * 95n) / 100n; // 5% 场景税
    if (payout > 0n) {
      await this.economyService.addCurrency(
        winnerPlayerId,
        CurrencyType.GOLD,
        Number(payout),
        'street_game_win',
        `session:${sessionId}:finish`,
        sessionId,
      );
    }
    session.status = GameSessionStatus.FINISHED;
    session.winnerPlayerId = winnerPlayerId;
    session.finishedAt = new Date();
    await this.sessionRepo.save(session);
    return { winner: winnerPlayerId, payout: payout.toString() };
  }

  async leaveLandmarkMessage(
    playerId: string,
    objectId: string,
    content: string,
  ): Promise<LandmarkMessage> {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 100) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '留言1-100字');
    }
    const msg = this.landmarkMsgRepo.create({
      objectId,
      playerId,
      content: trimmed,
    });
    return this.landmarkMsgRepo.save(msg);
  }

  async listLandmarkMessages(objectId: string): Promise<LandmarkMessage[]> {
    return this.landmarkMsgRepo.find({
      where: { objectId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
