import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncounterTemplate, PlayerExploration } from './entities';
import { Scene } from '@modules/world/entities';
import { CharacterService } from '@modules/character/character.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { BuffService } from '@modules/buff/buff.service';
import { ConfigManageService } from '@modules/config/config.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
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
    throw new Error('not-implemented');
  }

  /** 探索足迹：幂等 upsert + times 递增，首探经既有效益通道发里程碑奖 */
  async discover(playerId: string, sceneId: string): Promise<DiscoverResult> {
    throw new Error('not-implemented');
  }

  /** 奇遇触发：触发率 / CD / 一次性判定，命中返回当前选项 */
  async triggerEncounter(
    playerId: string,
    sceneId: string,
  ): Promise<EncounterTriggerResult> {
    throw new Error('not-implemented');
  }

  /** 奇遇结算：choice → effects 经既有 economy/inventory/buff，幂等防重复 */
  async resolveEncounter(
    playerId: string,
    encounterId: string,
    choiceId: string,
  ): Promise<ResolveResult> {
    throw new Error('not-implemented');
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