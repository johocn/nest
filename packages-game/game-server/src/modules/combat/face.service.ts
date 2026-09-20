import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CombatLog } from './entities';
import { EconomyService } from '@modules/economy/economy.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { CurrencyType, CombatResult } from '@constants/enums';
import { PlayerService } from '@modules/player/player.service';

const FACE_SOURCE = 'social_combat';

@Injectable()
export class FaceService {
  constructor(
    @InjectRepository(CombatLog)
    private readonly combatLogRepo: Repository<CombatLog>,
    private readonly economyService: EconomyService,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
    private readonly playerService: PlayerService,
  ) {}

  async adjustFace(
    playerId: string,
    delta: number,
    reason: string,
  ): Promise<{ balanceAfter: string }> {
    if (!/^\d+$/.test(playerId) || delta === 0 || !reason) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const opTrace = reason;
    const result =
      delta > 0
        ? await this.economyService.addCurrency(
            playerId,
            CurrencyType.FACE,
            delta,
            FACE_SOURCE,
            opTrace,
          )
        : await this.economyService.deductCurrency(
            playerId,
            CurrencyType.FACE,
            -delta,
            FACE_SOURCE,
            opTrace,
          );
    this.eventBus.emit(GameEvents.FACE_CHANGED, {
      playerId,
      delta,
      reason,
      balanceAfter: result.balanceAfter,
    });
    return result;
  }

  async applyFaceRule(
    winnerId: string,
    loserId: string,
    winnerLevel: number,
    loserLevel: number,
    forfeited = false,
  ): Promise<{
    winnerId: string;
    winnerFace: string;
    loserId: string;
    loserFace: string;
  }> {
    if (
      !/^\d+$/.test(winnerId) ||
      !/^\d+$/.test(loserId) ||
      winnerLevel < 0 ||
      loserLevel < 0
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const upset = winnerLevel < loserLevel;
    const winnerDelta = upset ? 15 : 10;
    const winner = await this.economyService.addCurrency(
      winnerId,
      CurrencyType.FACE,
      winnerDelta,
      FACE_SOURCE,
      'battle_win',
    );
    let loserFace: string;
    if (forfeited) {
      const loser = await this.economyService.deductCurrency(
        loserId,
        CurrencyType.FACE,
        10,
        FACE_SOURCE,
        'battle_forfeit',
      );
      loserFace = loser.balanceAfter;
    } else if (upset) {
      const loser = await this.economyService.deductCurrency(
        loserId,
        CurrencyType.FACE,
        15,
        FACE_SOURCE,
        'battle_lose',
      );
      loserFace = loser.balanceAfter;
    } else {
      loserFace = await this.economyService.getBalance(loserId, CurrencyType.FACE);
    }
    return {
      winnerId,
      winnerFace: winner.balanceAfter,
      loserId,
      loserFace,
    };
  }

  async publicShame(
    shamerId: string,
    targetId: string,
  ): Promise<{ shamerId: string; targetId: string }> {
    if (!/^\d+$/.test(shamerId) || !/^\d+$/.test(targetId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    if (shamerId === targetId) {
      throw new GameException(
        ErrorCodes.SHAME_TARGET_INVALID,
        '不可羞辱自己',
      );
    }
    await this.adjustFace(shamerId, 5, 'shame_win');
    await this.adjustFace(targetId, -30, 'shamed');
    await this.cacheService.set(`shame:${targetId}`, '1', 86400);
    this.eventBus.emit(GameEvents.GRUDGE_DECLARED, { shamerId, targetId });
    return { shamerId, targetId };
  }

  async declareGrudge(
    playerId: string,
    targetId: string,
  ): Promise<{ playerId: string; targetId: string }> {
    if (!/^\d+$/.test(playerId) || !/^\d+$/.test(targetId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    // 新手保护：红名（恶名>0）不可主动向新手宣战
    const infamy = await this.economyService.getBalance(
      playerId,
      CurrencyType.INFAMY,
    );
    if (Number(infamy) > 0) {
      const targetNewbie = await this.playerService.isNewbie(targetId);
      if (targetNewbie.protected) {
        throw new GameException(
          ErrorCodes.RED_NAME_TARGET_PROTECTED,
          '红名不可主动攻击新手',
        );
      }
    }
    await this.cacheService.set(
      `grudge:${playerId}:${targetId}`,
      '1',
      604800,
    );
    this.eventBus.emit(GameEvents.GRUDGE_DECLARED, { playerId, targetId });
    return { playerId, targetId };
  }

  async createBattleReport(combatLogId: string): Promise<{
    combatLogId: string;
    winnerId: string;
    loserId: string;
    damageJson: Record<string, any>;
    rewardJson: Record<string, any>;
    reportedAt: Date;
  }> {
    if (!/^\d+$/.test(combatLogId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const log = await this.combatLogRepo.findOne({
      where: { id: combatLogId },
    });
    if (!log) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '战斗记录不存在');
    }
    const attackerWon = log.result === CombatResult.WIN;
    const report = {
      combatLogId,
      winnerId: attackerWon ? log.attackerId : log.defenderId,
      loserId: attackerWon ? log.defenderId : log.attackerId,
      damageJson: log.damageJson,
      rewardJson: log.rewardJson,
      reportedAt: log.createdAt ?? new Date(),
    };
    this.eventBus.emit(GameEvents.BATTLE_REPORTED, report);
    return report;
  }

  async applyDefeatBuff(playerId: string): Promise<void> {
    if (!/^\d+$/.test(playerId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    await this.cacheService.set(`buff:recovery:${playerId}`, '1', 3600);
  }

  async getActiveBuffs(playerId: string): Promise<{
    recovery: boolean;
    shameWindow: boolean;
  }> {
    if (!/^\d+$/.test(playerId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const [recovery, shameWindow] = await Promise.all([
      this.cacheService.get(`buff:recovery:${playerId}`),
      this.cacheService.get(`shame:${playerId}`),
    ]);
    return { recovery: recovery === '1', shameWindow: shameWindow === '1' };
  }
}
