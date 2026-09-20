import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { EncounterTemplate, PlayerExploration } from './entities';
import { Scene } from '@modules/world/entities';
import { CharacterService } from '@modules/character/character.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { BuffService } from '@modules/buff/buff.service';
import { ConfigManageService } from '@modules/config/config.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { CurrencyType } from '@constants/enums';

export interface WorldState {
  timeOfDay: 'day' | 'night';
  weather: 'sunny' | 'rainy';
  hour: string;
}

export interface EncounterOption {
  id: string;
  label: string;
}

export interface EncounterTriggerResult {
  encounterId?: string;
  title?: string;
  descText?: string;
  options?: EncounterOption[];
  hit: boolean;
  reason?: 'none' | 'miss' | 'cooldown' | 'once_used';
}

export interface DiscoverResult {
  sceneId: string;
  times: number;
  first: boolean;
  delivered: string[];
}

export interface ResolveResult {
  encounterId: string;
  choiceId: string;
  delivered: string[];
}

interface RewardItem {
  currency?: Array<{ currencyType: CurrencyType; amount: number }>;
  items?: Array<{ itemTemplateId: string; quantity: number }>;
}

interface EncounterEffect {
  type: 'currency' | 'item' | 'buff' | 'deductCurrency' | 'removeItem';
  currencyType?: CurrencyType;
  amount?: number;
  itemTemplateId?: string;
  quantity?: number;
  buffTemplateId?: string;
}

@Injectable()
export class ExploreService {
  constructor(
    @InjectRepository(EncounterTemplate)
    private readonly encRepo: Repository<EncounterTemplate>,
    @InjectRepository(PlayerExploration)
    private readonly explRepo: Repository<PlayerExploration>,
    @InjectRepository(Scene)
    private readonly sceneRepo: Repository<Scene>,
    private readonly characterService: CharacterService,
    private readonly economyService: EconomyService,
    private readonly inventoryService: InventoryService,
    private readonly buffService: BuffService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigManageService,
    private readonly eventBus: EventBusService,
  ) {}

  /** 昼夜 / 天气：以 SQL now() 为准，不依赖服务器本地时区 */
  async worldState(): Promise<WorldState> {
    let rows: Array<{ now: unknown; hour: string; day: string }> = [];
    try {
      rows = await this.encRepo.manager.query(
        "SELECT NOW() AS now, to_char(NOW(), 'HH24') AS hour, to_char(NOW(), 'YYYY-MM-DD') AS day",
      );
    } catch {
      rows = [];
    }
    const row = rows?.[0];
    const hour = String(row?.hour ?? '0');
    const h = parseInt(hour, 10) || 0;
    const timeOfDay: 'day' | 'night' =
      h >= 6 && h < 18 ? 'day' : 'night';
    const weather = this.weatherOf(String(row?.day ?? ''));
    return { timeOfDay, weather, hour };
  }

  private weatherOf(day: string): 'sunny' | 'rainy' {
    let hash = 0;
    for (let i = 0; i < day.length; i++) {
      hash = (hash * 31 + day.charCodeAt(i)) & 0x7fffffff;
    }
    return hash % 2 === 0 ? 'sunny' : 'rainy';
  }

  /** 探索足迹：幂等 upsert + times 递增，首探经既有效益通道发里程碑奖 */
  async discover(playerId: string, sceneId: string): Promise<DiscoverResult> {
    const scene = await this.sceneRepo.findOne({ where: { id: sceneId } });
    if (!scene) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '场景不存在');
    }
    const existing = await this.explRepo.findOne({
      where: { playerId, sceneId },
    });
    if (existing) {
      existing.times = (existing.times ?? 1) + 1;
      await this.explRepo.save(existing);
      return { sceneId, times: existing.times, first: false, delivered: [] };
    }

    // 首探：读取足迹里程碑配置并结算（走既有 economy/inventory 发奖通道）
    let reward: RewardItem = {};
    try {
      const cfg = await this.configService.getTypedValue<any>(
        'explore.milestone',
      );
      reward = cfg?.reward ?? {};
    } catch {
      reward = {};
    }
    const delivered = await this.deliverMilestone(playerId, reward);
    const rec = this.explRepo.create({ playerId, sceneId, times: 1 });
    try {
      await this.explRepo.save(rec);
    } catch {
      // uk(player_id, scene_id) 并发兜底：重复时只递增 times，不重复发奖
      const dup = await this.explRepo.findOne({
        where: { playerId, sceneId },
      });
      if (dup) {
        dup.times = (dup.times ?? 0) + 1;
        await this.explRepo.save(dup);
        return { sceneId, times: dup.times, first: false, delivered: [] };
      }
      throw new GameException(ErrorCodes.DATABASE_ERROR, '探索足迹写入失败');
    }
    this.eventBus.emit(GameEvents.EXPLORE_SCENE_DISCOVERED, {
      playerId,
      sceneId,
    });
    return { sceneId, times: 1, first: true, delivered };
  }

  private async deliverMilestone(
    playerId: string,
    reward: RewardItem,
  ): Promise<string[]> {
    const effects: EncounterEffect[] = [];
    for (const c of reward.currency ?? []) {
      effects.push({
        type: 'currency',
        currencyType: c.currencyType,
        amount: c.amount,
      });
    }
    for (const it of reward.items ?? []) {
      effects.push({
        type: 'item',
        itemTemplateId: it.itemTemplateId,
        quantity: it.quantity,
      });
    }
    return this.deliverEffects(playerId, effects, 'explore_milestone');
  }

  /** 奇遇触发：触发率 / CD / 一次性判定，命中返回当前选项 */
  async triggerEncounter(
    playerId: string,
    sceneId: string,
  ): Promise<EncounterTriggerResult> {
    const world = await this.worldState();
    const templates = await this.encRepo.find({ where: { isActive: true } });
    const pool = templates.filter(
      (t) => t.sceneId === sceneId || t.sceneId == null,
    );
    if (!pool.length) return { hit: false, reason: 'none' };

    const t = pool[0]; // 当前取场景下首个模板作为候选（可扩展为权重随机）
    // 天气加成（读 remote_configs explore.weather，缺失默认晴天无加成）
    let weatherBonus = 0;
    try {
      const wc = await this.configService.getTypedValue<any>(
        'explore.weather',
      );
      weatherBonus = wc?.rainyTriggerBonus ?? 0;
    } catch {
      weatherBonus = 0;
    }
    const effRate =
      (t.triggerRate ?? 0.1) + (world.weather === 'rainy' ? weatherBonus : 0);
    if (Math.random() >= effRate) return { hit: false, reason: 'miss' };

    const cdSeconds = t.cdSeconds ?? 300;
    const cdKey = `explore:cd:${t.id}:${playerId}`;
    const cdOk = await this.cacheService.acquireLock(cdKey, cdSeconds);
    if (!cdOk) return { hit: false, reason: 'cooldown' };

    if (t.isOneTime) {
      const onceKey = `explore:once:${t.id}:${playerId}`;
      const usedOnce = await this.cacheService.get(onceKey);
      if (usedOnce) return { hit: false, reason: 'once_used' };
      await this.cacheService.set(onceKey, '1', 31536000);
    }

    const encounterId = randomUUID();
    const choices = (t.choicesJson ?? []).map((c: any) => ({
      id: c.id,
      label: c.label,
    }));
    await this.cacheService.set(
      `explore:enc:${encounterId}`,
      JSON.stringify({
        encounterId,
        playerId,
        templateId: t.id,
        sceneId,
        title: t.title,
        descText: t.descText,
        choices: t.choicesJson ?? [],
        resolved: false,
      }),
      cdSeconds,
    );
    this.eventBus.emit(GameEvents.ENCOUNTER_TRIGGERED, {
      playerId,
      encounterId,
      templateId: t.id,
      sceneId,
    });
    return {
      encounterId,
      title: t.title,
      descText: t.descText,
      options: choices,
      hit: true,
    };
  }

  /** 奇遇结算：choice → effects 经既有 economy/inventory/buff，幂等防重复 */
  async resolveEncounter(
    playerId: string,
    encounterId: string,
    choiceId: string,
  ): Promise<ResolveResult> {
    const encKey = `explore:enc:${encounterId}`;
    // 幂等：以 res 锁保证单次结算，锁占用中视为已结算
    const locked = await this.cacheService.acquireLock(
      `explore:res:${encounterId}`,
      300,
    );
    if (!locked) {
      throw new GameException(
        ErrorCodes.ENCOUNTER_ALREADY_RESOLVED,
        '该奇遇已结算',
      );
    }
    const raw = await this.cacheService.get(encKey);
    if (!raw) {
      throw new GameException(
        ErrorCodes.ENCOUNTER_NOT_FOUND,
        '奇遇不存在或已过期',
      );
    }
    const enc = JSON.parse(raw);
    const choice = (enc.choices ?? []).find((c: any) => c.id === choiceId);
    if (!choice) {
      throw new GameException(ErrorCodes.ENCOUNTER_CHOICE_INVALID, '选项不存在');
    }
    const delivered = await this.deliverEffects(
      playerId,
      choice.effects ?? [],
      `explore_encounter:${enc.templateId}`,
    );
    await this.cacheService.del(encKey);
    this.eventBus.emit(GameEvents.ENCOUNTER_RESOLVED, {
      playerId,
      encounterId,
      choiceId,
      delivered,
    });
    return { encounterId, choiceId, delivered };
  }

  // ---------- admin 奇遇模板 CRUD ----------
  async createTemplate(data: Partial<EncounterTemplate>): Promise<EncounterTemplate> {
    const t = this.encRepo.create(data);
    return this.encRepo.save(t);
  }

  async updateTemplate(
    id: string,
    data: Partial<EncounterTemplate>,
  ): Promise<EncounterTemplate> {
    const t = await this.encRepo.findOne({ where: { id } });
    if (!t) {
      throw new GameException(
        ErrorCodes.ENCOUNTER_TEMPLATE_NOT_FOUND,
        '奇遇模板不存在',
      );
    }
    Object.assign(t, data);
    return this.encRepo.save(t);
  }

  async removeTemplate(id: string): Promise<void> {
    await this.encRepo.delete(id);
  }

  async listTemplates(): Promise<EncounterTemplate[]> {
    return this.encRepo.find({ order: { id: 'DESC' } });
  }

  /** 复用既有 economy/inventory/buff 通道结算 effects */
  private async deliverEffects(
    playerId: string,
    effects: EncounterEffect[],
    source: string,
  ): Promise<string[]> {
    const labels: string[] = [];
    for (const e of effects ?? []) {
      if (e.type === 'currency' && e.currencyType && e.amount) {
        await this.economyService.addCurrency(
          playerId,
          e.currencyType,
          e.amount,
          source,
          `${source}:${playerId}`,
          undefined,
        );
        labels.push(`currency:${e.currencyType}:${e.amount}`);
      } else if (e.type === 'item' && e.itemTemplateId && e.quantity) {
        await this.inventoryService.addItem(
          playerId,
          e.itemTemplateId,
          e.quantity,
          `${source}:${playerId}`,
        );
        labels.push(`item:${e.itemTemplateId}:${e.quantity}`);
      } else if (e.type === 'buff' && e.buffTemplateId) {
        const char = await this.characterService.getByPlayerId(playerId);
        if (char) {
          await this.buffService.applyBuff(char.id, e.buffTemplateId);
          labels.push(`buff:${e.buffTemplateId}`);
        }
      } else if (e.type === 'deductCurrency' && e.currencyType && e.amount) {
        await this.economyService.deductCurrency(
          playerId,
          e.currencyType,
          e.amount,
          source,
          `${source}:${playerId}`,
          undefined,
        );
        labels.push(`deduct:${e.currencyType}:${e.amount}`);
      } else if (e.type === 'removeItem' && e.itemTemplateId && e.quantity) {
        await this.inventoryService.removeItem(
          playerId,
          e.itemTemplateId,
          e.quantity,
          `${source}:${playerId}`,
        );
        labels.push(`remove:${e.itemTemplateId}:${e.quantity}`);
      }
    }
    return labels;
  }
}