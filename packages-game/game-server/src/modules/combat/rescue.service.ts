import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RescueLog, CombatLog } from './entities';
import { CharacterService } from '@modules/character/character.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { RelationshipLevel } from '@constants/enums';

const RESCUE_DAILY_TTL = 86400;
const RESCUE_DAILY_LIMIT = 5;

@Injectable()
export class RescueService {
  constructor(
    @InjectRepository(RescueLog)
    private readonly rescueRepo: Repository<RescueLog>,
    @InjectRepository(CombatLog)
    private readonly combatLogRepo: Repository<CombatLog>,
    private readonly characterService: CharacterService,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  async performCombo(
    attackerId: string,
    partnerId: string,
    combatLogId?: string,
  ): Promise<{ comboBonus: number; level: RelationshipLevel }> {
    if (
      !/^\d+$/.test(attackerId) ||
      !/^\d+$/.test(partnerId) ||
      (combatLogId !== undefined && !/^\d+$/.test(combatLogId))
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const level = await this.characterService.getRelationshipLevel(
      attackerId,
      partnerId,
    );
    if (
      level !== RelationshipLevel.FRIEND &&
      level !== RelationshipLevel.CONFIDANT &&
      level !== RelationshipLevel.SWORN
    ) {
      throw new GameException(ErrorCodes.TACIT_NOT_ENOUGH, '默契不足，无法合击');
    }
    const comboBonus = level === RelationshipLevel.FRIEND ? 0.2 : 0.4;
    if (combatLogId !== undefined) {
      const log = await this.combatLogRepo.findOne({
        where: { id: combatLogId },
      });
      if (log) {
        log.damageJson = {
          ...(log.damageJson ?? {}),
          combo: { partnerId, bonus: comboBonus },
        };
        await this.combatLogRepo.save(log);
      }
    }
    this.eventBus.emit(GameEvents.COMBO_TRIGGERED, {
      attackerId,
      partnerId,
      comboBonus,
      level,
    });
    return { comboBonus, level };
  }

  async attemptRescue(rescuerId: string, targetId: string): Promise<RescueLog> {
    if (!/^\d+$/.test(rescuerId) || !/^\d+$/.test(targetId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const level = await this.characterService.getRelationshipLevel(
      rescuerId,
      targetId,
    );
    if (
      level !== RelationshipLevel.CONFIDANT &&
      level !== RelationshipLevel.SWORN
    ) {
      throw new GameException(ErrorCodes.RESCUE_TARGET_INVALID, '关系不足，无法援护');
    }
    const key = `rescue:daily:${rescuerId}`;
    const count = Number((await this.cacheService.get(key)) ?? 0);
    if (count > RESCUE_DAILY_LIMIT) {
      throw new GameException(ErrorCodes.RESCUE_DAILY_CAP, '今日援护次数已达上限');
    }
    await this.cacheService.set(key, String(count + 1), RESCUE_DAILY_TTL);

    const log = this.rescueRepo.create({
      rescuerId,
      targetId,
      combatLogId: null,
    });
    const saved = await this.rescueRepo.save(log);

    await this.characterService.increaseFavorability(rescuerId, targetId, 5);
    await this.characterService.increaseFavorability(targetId, rescuerId, 5);
    this.eventBus.emit(GameEvents.RESCUE_SUCCESS, { rescuerId, targetId });
    return saved;
  }

  async getRescueCount(
    playerId: string,
  ): Promise<{ today: number; total: number }> {
    if (!/^\d+$/.test(playerId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const today = Number(
      (await this.cacheService.get(`rescue:daily:${playerId}`)) ?? 0,
    );
    const total = await this.rescueRepo.count({
      where: { rescuerId: playerId },
    });
    return { today, total };
  }

  async getRescueLogs(playerId: string): Promise<RescueLog[]> {
    if (!/^\d+$/.test(playerId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return this.rescueRepo.find({
      where: { rescuerId: playerId },
      order: { createdAt: 'DESC' },
    });
  }
}
