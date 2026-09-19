import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CombatLootLog, CombatLog } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { LootDistributionMode } from '@constants/enums';

interface LootPlayersItem {
  playerId: string;
  ratio?: number;
  points?: number;
  amount: number;
}

@Injectable()
export class LootService {
  constructor(
    @InjectRepository(CombatLootLog)
    private readonly lootLogRepo: Repository<CombatLootLog>,
    @InjectRepository(CombatLog)
    private readonly combatLogRepo: Repository<CombatLog>,
    private readonly eventBus: EventBusService,
    @Optional() private readonly random: () => number = Math.random,
  ) {}

  async distributeLoot(
    distributorId: string,
    combatLogId: string,
    mode: LootDistributionMode,
    itemsJson: Record<string, any> = {},
  ): Promise<CombatLootLog> {
    if (
      !/^\d+$/.test(distributorId) ||
      !/^\d+$/.test(combatLogId)
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const log = await this.combatLogRepo.findOne({
      where: { id: combatLogId },
    });
    if (!log) {
      throw new GameException(ErrorCodes.LOOT_NOT_FOUND, '战斗记录不存在');
    }
    const items: unknown[] = Array.isArray(itemsJson.items)
      ? itemsJson.items
      : [];
    const parties = (players?: unknown[]): string[] => {
      const list = Array.isArray(players)
        ? players.filter((p) => typeof p === 'string' && /^\d+$/.test(p))
        : [];
      return list.length ? (list as string[]) : [log.attackerId, log.defenderId];
    };

    let playersJson: LootPlayersItem[];
    switch (mode) {
      case LootDistributionMode.CONTRIBUTION: {
        const contribution = Array.isArray(log.damageJson?.contribution)
          ? log.damageJson.contribution
          : [];
        playersJson = contribution.length
          ? contribution.map((c: any) => ({
              playerId: c.playerId,
              ratio: c.ratio,
              amount: Math.round(items.length * c.ratio),
            }))
          : this.splitEqual(parties(itemsJson.players), items.length);
        break;
      }
      case LootDistributionMode.ROLL: {
        const players = parties(itemsJson.players);
        const rolls = players.map((p) => ({
          playerId: p,
          points: Math.floor(this.random() * 100),
        }));
        const maxPoints = Math.max(...rolls.map((r) => r.points));
        playersJson = rolls.map((r) => ({
          playerId: r.playerId,
          points: r.points,
          amount: r.points === maxPoints ? items.length : 0,
        }));
        break;
      }
      case LootDistributionMode.CAPTAIN: {
        const winnerId = itemsJson.winnerId;
        if (!winnerId || !/^\d+$/.test(String(winnerId))) {
          throw new GameException(ErrorCodes.PARAM_INVALID, '缺少指定得主');
        }
        playersJson = [{ playerId: String(winnerId), ratio: 1, amount: items.length }];
        break;
      }
      case LootDistributionMode.EQUAL: {
        playersJson = this.splitEqual(
          parties(itemsJson.players),
          items.length,
        );
        break;
      }
    }

    const record = this.lootLogRepo.create({
      combatLogId,
      mode,
      distributorId,
      itemsJson,
      playersJson,
    });
    const saved = await this.lootLogRepo.save(record);
    this.eventBus.emit(GameEvents.LOOT_DISTRIBUTED, {
      combatLogId,
      mode,
      playersJson,
    });
    return saved;
  }

  private splitEqual(players: string[], itemCount: number): LootPlayersItem[] {
    const amount = Math.floor(itemCount / players.length);
    return players.map((p) => ({
      playerId: p,
      ratio: 1 / players.length,
      amount,
    }));
  }

  async getLootLog(combatLogId: string): Promise<CombatLootLog | null> {
    if (!/^\d+$/.test(combatLogId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return this.lootLogRepo.findOne({ where: { combatLogId } });
  }
}
