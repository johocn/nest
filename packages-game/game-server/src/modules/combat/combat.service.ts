import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CombatLog } from './entities';
import { SkillService } from '@modules/skill/skill.service';
import { BuffService } from '@modules/buff/buff.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { CombatType, CombatResult } from '@constants/enums';

export interface PveCombatParams {
  attackerId: string;
  defenderId: string;
  attackerStats: {
    strength: number;
    speed: number;
    defense: number;
    intelligence: number;
    comprehension: number;
    loyalty: number;
  };
  defenderHp: number;
  defenderDefense: number;
  skillId: string;
  attackerMp: number;
  sceneId: string;
}

export interface CombatResultDto {
  result: CombatResult;
  damageDealt: number;
  defenderRemainingHp: number;
  attackerMpRemaining: number;
  combatLogId: string;
}

@Injectable()
export class CombatService {
  constructor(
    @InjectRepository(CombatLog)
    private readonly combatLogRepo: Repository<CombatLog>,
    private readonly skillService: SkillService,
    private readonly buffService: BuffService,
    private readonly eventBus: EventBusService,
  ) {}

  async resolvePveCombat(params: PveCombatParams): Promise<CombatResultDto> {
    const startTime = Date.now();

    // Cast skill (includes cooldown check, MP check, damage calc)
    const castResult = await this.skillService.castSkill(
      params.attackerId,
      params.skillId,
      params.defenderId,
      params.attackerStats,
      params.attackerMp,
    );

    // Calculate actual damage: skill damage - defender defense (min 1)
    const damageDealt = Math.max(1, castResult.damage - params.defenderDefense);
    const defenderRemainingHp = Math.max(0, params.defenderHp - damageDealt);
    const attackerMpRemaining = params.attackerMp - castResult.mpCost;

    // Determine result
    const result =
      defenderRemainingHp <= 0 ? CombatResult.WIN : CombatResult.LOSE;

    // Create combat log
    const log = this.combatLogRepo.create({
      attackerId: params.attackerId,
      defenderId: params.defenderId,
      sceneId: params.sceneId,
      teamId: null,
      combatType: CombatType.PVE,
      result,
      damageJson: {
        skillId: castResult.skillId,
        skillName: castResult.skillName,
        rawDamage: castResult.damage,
        defenseReduction: params.defenderDefense,
        finalDamage: damageDealt,
        buffApplied: castResult.buffApplied,
      },
      rewardJson: {},
      durationMs: Date.now() - startTime,
    });
    const savedLog = await this.combatLogRepo.save(log);

    // Emit events
    if (result === CombatResult.WIN) {
      this.eventBus.emit(GameEvents.MONSTER_KILLED, {
        attackerId: params.attackerId,
        defenderId: params.defenderId,
        sceneId: params.sceneId,
      });
    }
    if (result === CombatResult.LOSE) {
      this.eventBus.emit(GameEvents.PLAYER_DIED, {
        playerId: params.attackerId,
        killerId: params.defenderId,
        sceneId: params.sceneId,
      });
    }

    return {
      result,
      damageDealt,
      defenderRemainingHp,
      attackerMpRemaining,
      combatLogId: savedLog.id,
    };
  }

  async getCombatLogs(
    characterId: string,
    page: number,
    limit: number,
  ): Promise<{ items: CombatLog[]; total: number }> {
    const [items, total] = await this.combatLogRepo.findAndCount({
      where: { attackerId: characterId },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }
}
