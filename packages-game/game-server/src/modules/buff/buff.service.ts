import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BuffTemplate } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';

export interface ActiveBuff {
  id: string;
  name: string;
  statModifiers: Record<string, number>;
  expiresAt: string;
}

export interface ModifiedStats {
  strength: number;
  speed: number;
  defense: number;
  intelligence: number;
  comprehension: number;
  loyalty: number;
}

@Injectable()
export class BuffService {
  private readonly BUFF_KEY = (characterId: string) =>
    `buff:character:${characterId}`;

  constructor(
    @InjectRepository(BuffTemplate)
    private readonly buffRepo: Repository<BuffTemplate>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async applyBuff(
    characterId: string,
    buffTemplateId: string,
  ): Promise<{ applied: boolean; buff: BuffTemplate }> {
    const template = await this.buffRepo.findOne({
      where: { id: buffTemplateId },
    });
    if (!template) {
      throw new Error('Buff模板不存在');
    }

    const expiresAt = (Date.now() + template.duration * 1000).toString();
    const activeBuff: ActiveBuff = {
      id: template.id,
      name: template.name,
      statModifiers: template.statModifiers,
      expiresAt,
    };

    await this.cacheService.hSet(
      this.BUFF_KEY(characterId),
      template.id,
      JSON.stringify(activeBuff),
    );
    await this.cacheService.expire(
      this.BUFF_KEY(characterId),
      template.duration,
    );

    this.eventBus.emit(GameEvents.ENTITY_SPAWNED, {
      characterId,
      buffId: template.id,
    });

    return { applied: true, buff: template };
  }

  async removeBuff(characterId: string, buffTemplateId: string): Promise<void> {
    await this.cacheService.hDel(this.BUFF_KEY(characterId), buffTemplateId);
  }

  async getActiveBuffs(characterId: string): Promise<ActiveBuff[]> {
    const data = await this.cacheService.hGetAll(this.BUFF_KEY(characterId));
    if (!data) return [];

    const buffs: ActiveBuff[] = [];
    for (const [id, json] of Object.entries(data)) {
      try {
        buffs.push(JSON.parse(json));
      } catch {
        // skip malformed entries
      }
    }
    return buffs;
  }

  async calculateModifiedStats(
    characterId: string,
    baseStats: ModifiedStats,
  ): Promise<ModifiedStats> {
    const buffs = await this.getActiveBuffs(characterId);
    const modified = { ...baseStats };

    for (const buff of buffs) {
      for (const [stat, value] of Object.entries(buff.statModifiers)) {
        if (stat in modified) {
          (modified as any)[stat] += value;
        }
      }
    }

    return modified;
  }

  async cleanExpiredBuffs(characterId: string): Promise<void> {
    const data = await this.cacheService.hGetAll(this.BUFF_KEY(characterId));
    if (!data) return;

    const now = Date.now();
    for (const [id, json] of Object.entries(data)) {
      try {
        const buff = JSON.parse(json) as ActiveBuff;
        if (parseInt(buff.expiresAt, 10) < now) {
          await this.cacheService.hDel(this.BUFF_KEY(characterId), id);
        }
      } catch {
        await this.cacheService.hDel(this.BUFF_KEY(characterId), id);
      }
    }
  }

  // ===== Admin CRUD =====

  async getTemplates(
    page: number,
    limit: number,
  ): Promise<{ items: BuffTemplate[]; total: number }> {
    const [items, total] = await this.buffRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getTemplate(id: string): Promise<BuffTemplate | null> {
    return this.buffRepo.findOne({ where: { id } });
  }

  async createTemplate(data: Partial<BuffTemplate>): Promise<BuffTemplate> {
    const template = this.buffRepo.create(data);
    return this.buffRepo.save(template);
  }

  async updateTemplate(
    id: string,
    data: Partial<BuffTemplate>,
  ): Promise<BuffTemplate | null> {
    const template = await this.buffRepo.findOne({ where: { id } });
    if (!template) return null;
    Object.assign(template, data);
    return this.buffRepo.save(template);
  }
}
