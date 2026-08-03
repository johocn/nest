import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SkillTemplate } from './entities';
import { CacheService } from '@cache/cache.service';
import { BuffService } from '@modules/buff/buff.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

export interface CastSkillResult {
  skillId: string;
  skillName: string;
  damage: number;
  mpCost: number;
  buffApplied: boolean;
}

export interface CharacterStats {
  strength: number;
  speed: number;
  defense: number;
  intelligence: number;
  comprehension: number;
  loyalty: number;
}

@Injectable()
export class SkillService {
  private readonly CD_KEY = (characterId: string, skillId: string) =>
    `cd:skill:${characterId}:${skillId}`;

  constructor(
    @InjectRepository(SkillTemplate)
    private readonly skillRepo: Repository<SkillTemplate>,
    private readonly cacheService: CacheService,
    private readonly buffService: BuffService,
  ) {}

  async castSkill(
    attackerId: string,
    skillTemplateId: string,
    defenderId: string,
    baseStats: CharacterStats,
    currentMp?: number,
  ): Promise<CastSkillResult> {
    const skill = await this.skillRepo.findOne({
      where: { id: skillTemplateId },
    });
    if (!skill) {
      throw new GameException(ErrorCodes.SKILL_NOT_LEARNED, '技能不存在');
    }

    // Check cooldown
    const onCooldown = await this.checkCooldown(attackerId, skillTemplateId);
    if (onCooldown) {
      throw new GameException(ErrorCodes.SKILL_COOLDOWN, '技能冷却中', {
        skillId: skillTemplateId,
      });
    }

    // Check MP
    if (currentMp !== undefined && currentMp < skill.mpCost) {
      throw new GameException(ErrorCodes.MP_NOT_ENOUGH, '蓝量不足', {
        current: currentMp,
        required: skill.mpCost,
      });
    }

    // Get buff-modified stats for attacker
    const modifiedStats = await this.buffService.calculateModifiedStats(
      attackerId,
      baseStats,
    );

    // Calculate damage: baseDamage + strength * 0.5
    const damage = skill.baseDamage + Math.floor(modifiedStats.strength * 0.5);

    // Set cooldown in Redis with TTL
    await this.cacheService.set(
      this.CD_KEY(attackerId, skillTemplateId),
      Date.now().toString(),
      skill.cooldown,
    );

    // Apply buff from effectJson if present
    let buffApplied = false;
    if (skill.effectJson?.buffId) {
      const buffTarget =
        skill.effectJson.buffTarget === 'self' ? attackerId : defenderId;
      await this.buffService.applyBuff(buffTarget, skill.effectJson.buffId);
      buffApplied = true;
    }

    return {
      skillId: skill.id,
      skillName: skill.name,
      damage,
      mpCost: skill.mpCost,
      buffApplied,
    };
  }

  async checkCooldown(
    characterId: string,
    skillTemplateId: string,
  ): Promise<boolean> {
    return this.cacheService.exists(this.CD_KEY(characterId, skillTemplateId));
  }

  // ===== Admin CRUD =====

  async getTemplates(
    page: number,
    limit: number,
  ): Promise<{ items: SkillTemplate[]; total: number }> {
    const [items, total] = await this.skillRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async getTemplate(id: string): Promise<SkillTemplate | null> {
    return this.skillRepo.findOne({ where: { id } });
  }

  async createTemplate(data: Partial<SkillTemplate>): Promise<SkillTemplate> {
    const template = this.skillRepo.create(data);
    return this.skillRepo.save(template);
  }

  async updateTemplate(
    id: string,
    data: Partial<SkillTemplate>,
  ): Promise<SkillTemplate | null> {
    const template = await this.skillRepo.findOne({ where: { id } });
    if (!template) return null;
    Object.assign(template, data);
    return this.skillRepo.save(template);
  }
}
