import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { BuffTemplate } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';

export interface ActiveBuff {
  id: string;
  name: string;
  statModifiers: Record<string, number>;
  expiresAt: string;
  duration: number;
}

export interface ModifiedStats {
  strength: number;
  speed: number;
  defense: number;
  intelligence: number;
  comprehension: number;
  loyalty: number;
}

/**
 * Buff 运行时服务 —— Redis 存储设计：
 *
 *  1. 每个 buff 独立 String key：`buff:{characterId}:{buffTemplateId}` → TTL = duration（秒）
 *     这样多 buff 同 character 互不覆盖、各自过期；Redis 自动删除，不需要定时清理。
 *  2. 额外一个 Set `buff:character:{characterId}:active` 记录当前 character 有哪些 buff templateId
 *     用于 getActiveBuffs 批量查询 —— 避免全库扫 Hash（v2 前的设计）。
 *     Set 本身**不设 TTL**，靠 per-buff String 写入时同步维护。
 *     cleanExpiredBuffs 做 Set 和 String 不一致的最终兜底。
 */
@Injectable()
export class BuffService {
  private readonly logger = new Logger(BuffService.name);

  private readonly activeSetKey = (characterId: string) =>
    `buff:character:${characterId}:active`;
  private readonly buffKey = (characterId: string, buffTemplateId: string) =>
    `buff:character:${characterId}:${buffTemplateId}`;

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
      duration: template.duration,
    };

    // per-buff String + 角色 active Set 两条同步写入
    await Promise.all([
      this.cacheService.set(
        this.buffKey(characterId, buffTemplateId),
        JSON.stringify(activeBuff),
        template.duration,
      ),
      this.cacheService.sAdd(this.activeSetKey(characterId), buffTemplateId),
    ]);

    this.eventBus.emit(GameEvents.BUFF_APPLIED, {
      characterId,
      buffTemplateId,
      buffName: template.name,
      duration: template.duration,
    });

    return { applied: true, buff: template };
  }

  async removeBuff(characterId: string, buffTemplateId: string): Promise<void> {
    await Promise.all([
      this.cacheService.del(this.buffKey(characterId, buffTemplateId)),
      this.cacheService.sRem(this.activeSetKey(characterId), buffTemplateId),
    ]);

    this.eventBus.emit(GameEvents.BUFF_REMOVED, {
      characterId,
      buffTemplateId,
    });
  }

  /** 从 active Set 拿到 templateId 列表 → 逐个查 String → 过滤已过期的 */
  async getActiveBuffs(characterId: string): Promise<ActiveBuff[]> {
    const ids = await this.cacheService.sMembers(this.activeSetKey(characterId));
    if (!ids || ids.length === 0) return [];

    // 并行查每个 per-buff String
    const raw = await Promise.all(
      ids.map((id) => this.cacheService.get(this.buffKey(characterId, id))),
    );

    const now = Date.now();
    const buffs: ActiveBuff[] = [];
    const expiredIds: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      const json = raw[i];
      if (!json) {
        // String 已过期（Redis 自动删了），但 Set 还留着 —— 标记清理
        expiredIds.push(ids[i]);
        continue;
      }
      try {
        const b = JSON.parse(json) as ActiveBuff;
        if (parseInt(b.expiresAt, 10) < now) {
          expiredIds.push(ids[i]);
          continue;
        }
        buffs.push(b);
      } catch {
        expiredIds.push(ids[i]);
      }
    }

    // 不一致兜底：把已过期的从 Set 移除（Redis 自动删 String 不碰 Set）
    if (expiredIds.length > 0) {
      await this.cacheService.sRem(this.activeSetKey(characterId), ...expiredIds);
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

  /** 手动清理（active Set 里已经过期的 String 兜底移除）—— 一般不需要调，Redis TTL 自动过期 */
  async cleanExpiredBuffs(characterId: string): Promise<number> {
    const buffs = await this.getActiveBuffs(characterId);
    // getActiveBuffs 内部已自动清 Set 中残留的过期 id，这里返回有效数量
    return buffs.length;
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

  async removeTemplate(id: string): Promise<void> {
    await this.buffRepo.delete(id);
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
