import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RealmTemplate } from './entities';
import { Character, CharacterAttribute } from '@modules/character/entities';
import { CharacterService } from '@modules/character/character.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { MailService } from '@modules/mail/mail.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { CurrencyType, MailSenderType } from '@constants/enums';

export interface RealmInfo {
  realmLevel: number;
  realmName: string;
  realmValue: string;
  bonus: Record<string, number>;
  next: { realmLevel: number; realmName: string; requiredValue: string } | null;
}

export interface BreakThroughResult {
  realmLevel: number;
  realmName: string;
  bonus: Record<string, number>;
  rewardDelivered: string[];
}

@Injectable()
export class RealmService {
  private readonly logger = new Logger(RealmService.name);

  constructor(
    @InjectRepository(Character)
    private readonly charRepo: Repository<Character>,
    @InjectRepository(CharacterAttribute)
    private readonly attrRepo: Repository<CharacterAttribute>,
    @InjectRepository(RealmTemplate)
    private readonly realmRepo: Repository<RealmTemplate>,
    private readonly characterService: CharacterService,
    private readonly inventoryService: InventoryService,
    private readonly economyService: EconomyService,
    private readonly mailService: MailService,
    private readonly eventBus: EventBusService,
  ) {}

  async getRealmInfo(playerId: string): Promise<RealmInfo> {
    const c = await this.findCharacter(playerId);
    const templates = await this.loadTemplatesSorted();
    const current = templates.find((t) => t.realmLevel === c.realmLevel);
    const next = templates.find((t) => t.realmLevel === c.realmLevel + 1) ?? null;
    return {
      realmLevel: c.realmLevel,
      realmName: current?.realmName ?? '',
      realmValue: c.realmValue,
      bonus: current?.statBonusJson ?? {},
      next: next
        ? {
            realmLevel: next.realmLevel,
            realmName: next.realmName,
            requiredValue: next.requiredValue,
          }
        : null,
    };
  }

  async cultivate(playerId: string, amount: number): Promise<{ realmValue: string }> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '修为数量必须大于0');
    }
    const c = await this.findCharacter(playerId);
    const current = BigInt(c.realmValue ?? '0');
    c.realmValue = (current + BigInt(Math.floor(amount))).toString();
    await this.charRepo.save(c);
    this.eventBus.emit(GameEvents.REALM_VALUE_GAINED, {
      playerId,
      amount: Math.floor(amount),
      realmValue: c.realmValue,
    });
    return { realmValue: c.realmValue };
  }

  async breakThrough(playerId: string): Promise<BreakThroughResult> {
    const c = await this.findCharacter(playerId);
    const templates = await this.loadTemplatesSorted();
    const next = templates.find((t) => t.realmLevel === c.realmLevel + 1);
    if (!next) {
      throw new GameException(ErrorCodes.REALM_ALREADY_MAX, '已达最高境界（满级）');
    }
    const required = BigInt(next.requiredValue ?? '0');
    const current = BigInt(c.realmValue ?? '0');
    if (current < required) {
      throw new GameException(ErrorCodes.REALM_VALUE_NOT_ENOUGH, '修为不足，未达突破阈值', {
        current: c.realmValue,
        required: next.requiredValue,
      });
    }

    // 1. 消耗养成道具（复用既有 inventory 消耗通道）
    const consume: Array<{ itemTemplateId: string; quantity: number }> =
      next.consumeItemsJson ?? [];
    for (const item of consume) {
      await this.inventoryService.removeItem(
        playerId,
        item.itemTemplateId,
        item.quantity,
        `realm_breakthrough:${c.realmLevel}->${next.realmLevel}`,
      );
    }

    // 2. 属性加成覆盖式叠加（delta = 新境界加成 − 旧境界加成，避免残留）
    const oldBonus = this.bonusOf(templates, c.realmLevel);
    const newBonus = this.bonusOf(templates, next.realmLevel);
    await this.applyBonus(c.id, oldBonus, newBonus);

    // 3. 里程碑发奖（按 realm_level 幂等去重）
    const claimed = Array.isArray(c.milestoneClaimedJson)
      ? [...c.milestoneClaimedJson]
      : [];
    const delivered: string[] = [];
    if (!claimed.includes(next.realmLevel)) {
      const labels = await this.deliverMilestone(
        playerId,
        next.realmLevel,
        next.milestoneRewardJson ?? {},
      );
      claimed.push(next.realmLevel);
      delivered.push(...labels);
    }

    // 4. 升级 + 扣减修为
    c.realmLevel = next.realmLevel;
    c.realmValue = (current - required).toString();
    c.milestoneClaimedJson = claimed;
    await this.charRepo.save(c);

    this.eventBus.emit(GameEvents.REALM_BREAKTHROUGH, {
      playerId,
      realmLevel: c.realmLevel,
      realmName: next.realmName,
      reward: delivered,
    });

    return {
      realmLevel: c.realmLevel,
      realmName: next.realmName,
      bonus: newBonus,
      rewardDelivered: delivered,
    };
  }

  private async findCharacter(playerId: string): Promise<Character> {
    const c = await this.characterService.getByPlayerId(playerId);
    if (!c) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return c;
  }

  private async loadTemplatesSorted(): Promise<RealmTemplate[]> {
    return this.realmRepo.find({ order: { realmLevel: 'ASC' } });
  }

  private bonusOf(
    templates: RealmTemplate[],
    level: number,
  ): Record<string, number> {
    const t = templates.find((x) => x.realmLevel === level);
    return t?.statBonusJson ?? {};
  }

  private async applyBonus(
    characterId: string,
    oldBonus: Record<string, number>,
    newBonus: Record<string, number>,
  ): Promise<void> {
    let attr = await this.attrRepo.findOne({ where: { characterId } });
    if (!attr) {
      attr = this.attrRepo.create({ characterId });
    }
    const keys = new Set([...Object.keys(oldBonus), ...Object.keys(newBonus)]);
    for (const k of keys) {
      if (k === 'combatPower') {
        const cur = BigInt((attr as any)[k] ?? '0');
        const oldV = BigInt(oldBonus[k] ?? 0);
        const newV = BigInt(newBonus[k] ?? 0);
        (attr as any).combatPower = (cur + newV - oldV).toString();
        continue;
      }
      const oldV = oldBonus[k] ?? 0;
      const newV = newBonus[k] ?? 0;
      (attr as any)[k] = ((attr as any)[k] ?? 0) + (newV - oldV);
    }
    await this.attrRepo.save(attr);
  }

  private async deliverMilestone(
    playerId: string,
    level: number,
    reward: Record<string, any>,
  ): Promise<string[]> {
    const labels: string[] = [];
    const currencies: Array<{ currencyType: CurrencyType; amount: number }> =
      reward.currency ?? [];
    for (const item of currencies) {
      await this.economyService.addCurrency(
        playerId,
        item.currencyType,
        item.amount,
        'realm_milestone',
        `realm_milestone:${playerId}:lv${level}`,
        String(level),
      );
      labels.push(`currency:${item.currencyType}:${item.amount}`);
    }
    if (reward.mail) {
      await this.mailService.sendMail({
        recipientId: playerId,
        senderType: MailSenderType.SYSTEM,
        title: reward.mail.title,
        content: reward.mail.content,
        attachmentJson: reward.mail.attachments ?? {},
      });
      labels.push(`mail:${playerId}:lv${level}`);
    }
    const items: Array<{ itemTemplateId: string; quantity: number }> =
      reward.items ?? [];
    for (const it of items) {
      await this.inventoryService.addItem(
        playerId,
        it.itemTemplateId,
        it.quantity,
        `realm_milestone:${playerId}:lv${level}`,
      );
      labels.push(`item:${it.itemTemplateId}:${it.quantity}`);
    }
    return labels;
  }

  async createTemplate(data: Partial<RealmTemplate>): Promise<RealmTemplate> {
    const t = this.realmRepo.create(data);
    return this.realmRepo.save(t);
  }

  async updateTemplate(
    id: string,
    data: Partial<RealmTemplate>,
  ): Promise<RealmTemplate> {
    const t = await this.realmRepo.findOne({ where: { id } });
    if (!t) {
      throw new GameException(ErrorCodes.REALM_TEMPLATE_NOT_FOUND, '境界模板不存在');
    }
    Object.assign(t, data);
    return this.realmRepo.save(t);
  }

  async removeTemplate(id: string): Promise<void> {
    await this.realmRepo.delete(id);
  }

  async listTemplates(): Promise<RealmTemplate[]> {
    return this.realmRepo.find({ order: { realmLevel: 'ASC' } });
  }
}