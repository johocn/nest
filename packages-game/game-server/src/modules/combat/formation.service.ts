import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Formation, FormationBinding } from './entities';
import { CharacterService } from '@modules/character/character.service';
import { SocialService } from '@modules/social/social.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  FormationType,
  RelationshipLevel,
  KinshipType,
} from '@constants/enums';

const FORMATION_ACTIVE_TTL = 86400;

@Injectable()
export class FormationService implements OnModuleInit {
  private static readonly SEED_TEMPLATES: Array<{
    name: string;
    type: FormationType;
    maxMembers: number;
    baseBonus: { attack: number; defense: number; heal: number };
    counterType: FormationType | null;
  }> = [
    {
      name: '三才阵',
      type: FormationType.THREE_TALENTS,
      maxMembers: 3,
      baseBonus: { attack: 10, defense: 10, heal: 10 },
      counterType: FormationType.BEIDOU,
    },
    {
      name: '五行阵',
      type: FormationType.FIVE_ELEMENTS,
      maxMembers: 5,
      baseBonus: { attack: 15, defense: 15, heal: 15 },
      counterType: FormationType.THREE_TALENTS,
    },
    {
      name: '北斗七星阵',
      type: FormationType.BEIDOU,
      maxMembers: 7,
      baseBonus: { attack: 20, defense: 20, heal: 20 },
      counterType: FormationType.FIVE_ELEMENTS,
    },
  ];

  constructor(
    @InjectRepository(Formation)
    private readonly formationRepo: Repository<Formation>,
    @InjectRepository(FormationBinding)
    private readonly bindingRepo: Repository<FormationBinding>,
    private readonly characterService: CharacterService,
    private readonly socialService: SocialService,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedFormations();
  }

  async seedFormations(): Promise<void> {
    for (const tpl of FormationService.SEED_TEMPLATES) {
      const existing = await this.formationRepo.findOne({
        where: { type: tpl.type },
      });
      if (existing) continue;
      await this.formationRepo.save(this.formationRepo.create(tpl));
    }
  }

  private async resolveFormationTemplate(
    formationId: string,
  ): Promise<Formation | null> {
    if (/^\d+$/.test(formationId)) {
      return this.formationRepo.findOne({ where: { id: formationId } });
    }
    if (
      Object.values(FormationType).includes(formationId as FormationType)
    ) {
      return this.formationRepo.findOne({
        where: { type: formationId as FormationType },
      });
    }
    return null;
  }

  async createFormation(
    leaderId: string,
    formationId: string,
  ): Promise<{ formationId: string; leaderId: string }> {
    if (
      !/^\d+$/.test(leaderId) ||
      (!/^\d+$/.test(formationId) &&
        !Object.values(FormationType).includes(formationId as FormationType))
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const template = await this.resolveFormationTemplate(formationId);
    if (!template) {
      throw new GameException(ErrorCodes.FORMATION_NOT_FOUND, '阵法模板不存在');
    }
    const existing = await this.bindingRepo.findOne({
      where: { playerId: leaderId },
    });
    if (existing) {
      throw new GameException(ErrorCodes.FORMATION_ACTIVE, '已在其它阵法中');
    }
    const binding = this.bindingRepo.create({
      formationId: template.id,
      leaderId,
      playerId: leaderId,
      position: 0,
    });
    await this.bindingRepo.save(binding);
    return { formationId: template.id, leaderId };
  }

  async joinFormation(
    playerId: string,
    formationId: string,
    position: number,
  ): Promise<FormationBinding> {
    if (!/^\d+$/.test(playerId) || !/^\d+$/.test(formationId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const template = await this.formationRepo.findOne({
      where: { id: formationId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.FORMATION_NOT_FOUND, '阵法不存在');
    }
    const existing = await this.bindingRepo.findOne({
      where: { playerId },
    });
    if (existing) {
      throw new GameException(ErrorCodes.FORMATION_ACTIVE, '已在其它阵法中');
    }
    const count = await this.bindingRepo.count({ where: { formationId } });
    if (count >= template.maxMembers) {
      throw new GameException(
        ErrorCodes.FORMATION_MEMBER_LIMIT,
        '阵法人数已满',
      );
    }
    const taken = await this.bindingRepo.findOne({
      where: { formationId, position },
    });
    if (taken) {
      throw new GameException(
        ErrorCodes.FORMATION_POSITION_TAKEN,
        '站位已被占用',
      );
    }
    const leader = await this.bindingRepo.findOne({
      where: { formationId, position: 0 },
    });
    if (!leader) {
      throw new GameException(ErrorCodes.FORMATION_NOT_FOUND, '阵法队长缺失');
    }
    const binding = this.bindingRepo.create({
      formationId,
      leaderId: leader.leaderId,
      playerId,
      position,
    });
    return this.bindingRepo.save(binding);
  }

  async leaveFormation(playerId: string, formationId: string): Promise<void> {
    if (!/^\d+$/.test(playerId) || !/^\d+$/.test(formationId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    await this.bindingRepo.delete({ formationId, playerId });
  }

  async activateFormation(
    leaderId: string,
    formationId: string,
  ): Promise<{ formationId: string; activated: boolean }> {
    if (!/^\d+$/.test(leaderId) || !/^\d+$/.test(formationId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const leader = await this.bindingRepo.findOne({
      where: { formationId, playerId: leaderId },
    });
    if (!leader || leader.leaderId !== leaderId) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '仅队长可操作');
    }
    const template = await this.formationRepo.findOne({
      where: { id: formationId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.FORMATION_NOT_FOUND, '阵法不存在');
    }
    const count = await this.bindingRepo.count({ where: { formationId } });
    if (count < template.maxMembers) {
      throw new GameException(
        ErrorCodes.FORMATION_MEMBER_LIMIT,
        '阵法未满员',
      );
    }
    await this.cacheService.set(
      `formation:active:${formationId}`,
      '1',
      FORMATION_ACTIVE_TTL,
    );
    this.eventBus.emit(GameEvents.FORMATION_ACTIVATED, {
      formationId,
      leaderId,
      type: template.type,
    });
    return { formationId, activated: true };
  }

  private static readonly TACIT_PERCENT: Record<RelationshipLevel, number> = {
    [RelationshipLevel.FRIEND]: 10,
    [RelationshipLevel.CONFIDANT]: 15,
    [RelationshipLevel.SWORN]: 20,
  } as Record<RelationshipLevel, number>;

  async getFormationBonus(
    formationId: string,
  ): Promise<{ attack: number; defense: number; heal: number }> {
    if (!/^\d+$/.test(formationId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const template = await this.formationRepo.findOne({
      where: { id: formationId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.FORMATION_NOT_FOUND, '阵法不存在');
    }
    const leader = await this.bindingRepo.findOne({
      where: { formationId, position: 0 },
    });
    if (!leader) {
      throw new GameException(ErrorCodes.FORMATION_NOT_FOUND, '阵法队长缺失');
    }
    const members = await this.bindingRepo.find({ where: { formationId } });

    let tacitPercent = 0;
    let kinshipBonus = false;
    const kinships = await this.socialService.getKinships(leader.leaderId);
    for (const member of members) {
      if (member.playerId === leader.leaderId) continue;
      const level = await this.characterService.getRelationshipLevel(
        leader.leaderId,
        member.playerId,
      );
      tacitPercent = Math.max(
        tacitPercent,
        FormationService.TACIT_PERCENT[level] ?? 0,
      );
      if (
        kinships.some(
          (k) =>
            (k.type === KinshipType.SWORN || k.type === KinshipType.COUPLE) &&
            Array.isArray(k.members) &&
            k.members.includes(leader.leaderId) &&
            k.members.includes(member.playerId),
        )
      ) {
        kinshipBonus = true;
      }
    }
    if (kinshipBonus) tacitPercent += 5;
    const factor = 1 + tacitPercent / 100;
    return {
      attack: Math.round(template.baseBonus.attack * factor),
      defense: Math.round(template.baseBonus.defense * factor),
      heal: Math.round(template.baseBonus.heal * factor),
    };
  }

  async checkCounter(
    attackerId: string,
    defenderId: string,
  ): Promise<{ countered: boolean; bonus: number }> {
    if (!/^\d+$/.test(attackerId) || !/^\d+$/.test(defenderId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const [attackerBinding, defenderBinding] = await Promise.all([
      this.bindingRepo.findOne({ where: { playerId: attackerId } }),
      this.bindingRepo.findOne({ where: { playerId: defenderId } }),
    ]);
    if (!attackerBinding || !defenderBinding) {
      return { countered: false, bonus: 0 };
    }
    const [attackerFormation, defenderFormation] = await Promise.all([
      this.formationRepo.findOne({ where: { id: attackerBinding.formationId } }),
      this.formationRepo.findOne({ where: { id: defenderBinding.formationId } }),
    ]);
    if (
      attackerFormation?.counterType &&
      attackerFormation.counterType === defenderFormation?.type
    ) {
      return { countered: true, bonus: 10 };
    }
    return { countered: false, bonus: 0 };
  }

  async getFormation(
    formationId: string,
  ): Promise<{
    template: Formation;
    members: FormationBinding[];
    active: boolean;
  }> {
    if (!/^\d+$/.test(formationId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const template = await this.formationRepo.findOne({
      where: { id: formationId },
    });
    if (!template) {
      throw new GameException(ErrorCodes.FORMATION_NOT_FOUND, '阵法不存在');
    }
    const members = await this.bindingRepo.find({
      where: { formationId },
      order: { position: 'ASC' },
    });
    const activeFlag = await this.cacheService.get(
      `formation:active:${formationId}`,
    );
    return { template, members, active: activeFlag === '1' };
  }
}
