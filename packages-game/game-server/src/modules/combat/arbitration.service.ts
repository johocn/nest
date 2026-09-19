import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CombatArbitration } from './entities';
import { CharacterService } from '@modules/character/character.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  ArbitrationStatus,
  RelationshipLevel,
} from '@constants/enums';

const GRUDGE_TTL = 604800;

@Injectable()
export class ArbitrationService {
  private static readonly LEVEL_SCORE: Record<RelationshipLevel, number> = {
    [RelationshipLevel.HOSTILE]: -2,
    [RelationshipLevel.FRIEND]: 1,
    [RelationshipLevel.CONFIDANT]: 2,
    [RelationshipLevel.SWORN]: 3,
  } as Record<RelationshipLevel, number>;

  constructor(
    @InjectRepository(CombatArbitration)
    private readonly arbitrationRepo: Repository<CombatArbitration>,
    private readonly characterService: CharacterService,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async startArbitration(
    arbitratorId: string,
    combatLogId: string,
    partiesJson: Record<string, any>,
    claimsJson: Record<string, any>,
  ): Promise<CombatArbitration> {
    if (
      !/^\d+$/.test(arbitratorId) ||
      !/^\d+$/.test(combatLogId) ||
      !partiesJson?.partyA ||
      !partiesJson?.partyB
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    if (
      arbitratorId === partiesJson.partyA ||
      arbitratorId === partiesJson.partyB
    ) {
      throw new GameException(
        ErrorCodes.ARBITRATION_NOT_READY,
        '仲裁人不可为当事方',
      );
    }
    const existing = await this.arbitrationRepo.findOne({
      where: { combatLogId, status: ArbitrationStatus.PENDING },
    });
    if (existing) {
      throw new GameException(
        ErrorCodes.ARBITRATION_EXISTS,
        '该战斗已有待仲裁记录',
      );
    }
    const record = this.arbitrationRepo.create({
      combatLogId,
      arbitratorId,
      partiesJson,
      claimsJson,
      status: ArbitrationStatus.PENDING,
      successRate: 0,
      result: null,
    });
    return this.arbitrationRepo.save(record);
  }

  async resolveArbitration(
    arbitrationId: string,
    result: string,
  ): Promise<CombatArbitration> {
    if (!/^\d+$/.test(arbitrationId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const record = await this.arbitrationRepo.findOne({
      where: { id: arbitrationId },
    });
    if (!record || record.status !== ArbitrationStatus.PENDING) {
      throw new GameException(
        ErrorCodes.ARBITRATION_NOT_READY,
        '仲裁记录不存在或已结算',
      );
    }
    const partyA = String(record.partiesJson?.partyA ?? '');
    const partyB = String(record.partiesJson?.partyB ?? '');
    const [levelA, levelB] = await Promise.all([
      this.characterService.getRelationshipLevel(partyA, partyB),
      this.characterService.getRelationshipLevel(partyB, partyA),
    ]);
    const avgLevel =
      ((ArbitrationService.LEVEL_SCORE[levelA] ?? 0) +
        (ArbitrationService.LEVEL_SCORE[levelB] ?? 0)) /
      2;
    const successRate = 60 + 10 + avgLevel * 10 - 20;

    record.result = result;
    record.successRate = successRate;
    if (successRate >= 50) {
      record.status = ArbitrationStatus.SUCCESS;
      await this.characterService.increaseFavorability(partyA, partyB, 10);
      await this.characterService.increaseFavorability(partyB, partyA, 10);
    } else {
      record.status = ArbitrationStatus.FAIL;
      await this.cacheService.set(
        `grudge:${partyA}:${partyB}`,
        '1',
        GRUDGE_TTL,
      );
      await this.cacheService.set(
        `grudge:${partyB}:${partyA}`,
        '1',
        GRUDGE_TTL,
      );
    }
    const saved = await this.arbitrationRepo.save(record);
    this.eventBus.emit(GameEvents.ARBITRATION_SETTLED, {
      arbitrationId,
      combatLogId: record.combatLogId,
      status: saved.status,
      successRate,
      result,
    });
    return saved;
  }

  async getArbitration(
    arbitrationId: string,
  ): Promise<CombatArbitration | null> {
    if (!/^\d+$/.test(arbitrationId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return this.arbitrationRepo.findOne({ where: { id: arbitrationId } });
  }
}
