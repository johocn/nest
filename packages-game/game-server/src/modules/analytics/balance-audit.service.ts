import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, In } from 'typeorm';
import { Transaction } from '@modules/economy/entities/transaction.entity';
import { Friend } from '@modules/social/entities/friend.entity';
import { Kinship } from '@modules/social/entities/kinship.entity';
import { Player } from '@modules/player/entities/player.entity';
import { PlayerCurrency } from '@modules/player/entities/player-currency.entity';
import { CombatLog } from '@modules/combat/entities/combat-log.entity';
import {
  CurrencyType,
  CombatType,
  CombatResult,
  FriendStatus,
  KinshipStatus,
  TransactionType,
} from '@constants/enums';

export interface BalanceAuditReport {
  social: {
    newPlayerCount: number;
    relatedNewPlayerCount: number;
    newPlayerRelationRate: number | null;
    socialCurrencyFlow: { total: string; byCurrency: Record<string, string> };
    activePlayers: number;
    healthy: boolean | null;
  };
  combat: {
    pvpBattles: number;
    pvpWinRate: number | null;
    distribution: { win: number; lose: number; draw: number };
    healthy: boolean | null;
  };
  economy: {
    goldStock: string;
    goldInflow30d: string;
    monthlyInflationRate: number | null;
    healthy: boolean | null;
  };
  growth: {
    playerCount: number;
    levelDistribution: Record<string, number>;
    avgHoursPerLevel: number | null;
  };
  health: boolean;
  generatedAt: string;
}

const MIN_RELATION_RATE = 60;
const PVP_HEALTHY_MIN = 40;
const PVP_HEALTHY_MAX = 60;
const MAX_MONTHLY_INFLATION = 30;

@Injectable()
export class BalanceAuditService {
  constructor(
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,
    @InjectRepository(Friend)
    private readonly friendRepo: Repository<Friend>,
    @InjectRepository(Kinship)
    private readonly kinshipRepo: Repository<Kinship>,
    @InjectRepository(Player)
    private readonly playerRepo: Repository<Player>,
    @InjectRepository(PlayerCurrency)
    private readonly currencyRepo: Repository<PlayerCurrency>,
    @InjectRepository(CombatLog)
    private readonly combatLogRepo: Repository<CombatLog>,
  ) {}

  async audit(): Promise<BalanceAuditReport> {
    const now = new Date();
    const day7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const day30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    const [social, combat, economy, growth] = await Promise.all([
      this.auditSocial(day7),
      this.auditCombat(),
      this.auditEconomy(day30),
      this.auditGrowth(),
    ]);

    const flags = [social.healthy, combat.healthy, economy.healthy].filter(
      (h): h is boolean => h !== null,
    );
    const health = flags.length > 0 ? flags.every(Boolean) : false;

    return {
      social,
      combat,
      economy,
      growth,
      health,
      generatedAt: now.toISOString(),
    };
  }

  private async auditSocial(day7: Date) {
    const newPlayers = await this.playerRepo.find({
      where: { createdAt: MoreThan(day7) },
    });
    const ids = newPlayers.map((p) => p.id);

    let relatedCount = 0;
    if (ids.length > 0) {
      const [friends, kinships] = await Promise.all([
        this.friendRepo.find({
          where: [
            { playerId: In(ids), status: FriendStatus.ACCEPTED },
            { friendId: In(ids), status: FriendStatus.ACCEPTED },
          ],
        }),
        this.kinshipRepo.find({ where: { status: KinshipStatus.ACTIVE } }),
      ]);
      relatedCount = ids.filter((id) => {
        const hasFriend = friends.some(
          (f) => f.playerId === id || f.friendId === id,
        );
        const hasKinship = kinships.some(
          (k) => Array.isArray(k.members) && k.members.includes(id),
        );
        return hasFriend || hasKinship;
      }).length;
    }

    const flowTx = await this.txRepo.find({
      where: {
        currencyType: In([
          CurrencyType.FAVOR,
          CurrencyType.GUILD_CONTRIB,
          CurrencyType.FACE,
        ]),
        createdAt: MoreThan(day7),
      },
    });
    const byCurrency: Record<string, string> = {
      [CurrencyType.FAVOR]: '0',
      [CurrencyType.GUILD_CONTRIB]: '0',
      [CurrencyType.FACE]: '0',
    };
    let flowTotal = BigInt(0);
    for (const tx of flowTx) {
      const delta = BigInt(tx.amount);
      const abs = delta < BigInt(0) ? -delta : delta;
      byCurrency[tx.currencyType] = (
        BigInt(byCurrency[tx.currencyType] ?? '0') + abs
      ).toString();
      flowTotal += abs;
    }

    const activeRows = await this.txRepo
      .createQueryBuilder('t')
      .select('DISTINCT t.player_id', 'playerId')
      .where('t.created_at >= :d', { d: day7 })
      .getRawMany<{ playerId: string }>();

    const rate =
      newPlayers.length > 0
        ? Math.round((relatedCount / newPlayers.length) * 100)
        : null;
    const healthy = rate === null ? null : rate >= MIN_RELATION_RATE;

    return {
      newPlayerCount: newPlayers.length,
      relatedNewPlayerCount: relatedCount,
      newPlayerRelationRate: rate,
      socialCurrencyFlow: {
        total: flowTotal.toString(),
        byCurrency,
      },
      activePlayers: activeRows.length,
      healthy,
    };
  }

  private async auditCombat() {
    const logs = await this.combatLogRepo.find({
      where: { combatType: CombatType.PVP },
    });
    const distribution = { win: 0, lose: 0, draw: 0 };
    for (const log of logs) {
      if (log.result === CombatResult.WIN) distribution.win += 1;
      else if (log.result === CombatResult.LOSE) distribution.lose += 1;
      else distribution.draw += 1;
    }
    const decided = distribution.win + distribution.lose;
    const winRate =
      decided > 0 ? Math.round((distribution.win / decided) * 100) : null;
    const healthy =
      winRate === null
        ? null
        : winRate >= PVP_HEALTHY_MIN && winRate <= PVP_HEALTHY_MAX;

    return { pvpBattles: logs.length, pvpWinRate: winRate, distribution, healthy };
  }

  private async auditEconomy(day30: Date) {
    const [goldRows, inflowTx] = await Promise.all([
      this.currencyRepo.find({ where: { currencyType: CurrencyType.GOLD } }),
      this.txRepo.find({
        where: {
          currencyType: CurrencyType.GOLD,
          txType: TransactionType.EARN,
          createdAt: MoreThan(day30),
        },
      }),
    ]);

    let goldStock = BigInt(0);
    for (const row of goldRows) {
      goldStock += BigInt(row.amount);
    }
    let inflow = BigInt(0);
    for (const tx of inflowTx) {
      inflow += BigInt(tx.amount);
    }

    const rate =
      goldStock > BigInt(0)
        ? Math.round((Number((inflow * BigInt(100)) / goldStock)))
        : null;
    const healthy =
      rate === null ? null : rate <= MAX_MONTHLY_INFLATION;

    return {
      goldStock: goldStock.toString(),
      goldInflow30d: inflow.toString(),
      monthlyInflationRate: rate,
      healthy,
    };
  }

  private async auditGrowth() {
    const players = await this.playerRepo.find();
    const levelDistribution: Record<string, number> = {};
    const now = Date.now();
    let totalHours = 0;
    let totalLevels = 0;

    for (const p of players) {
      levelDistribution[String(p.level)] =
        (levelDistribution[String(p.level)] ?? 0) + 1;
      const hours = (now - p.createdAt.getTime()) / 3600 / 1000;
      if (p.level > 0 && hours > 0) {
        totalHours += hours;
        totalLevels += p.level;
      }
    }

    return {
      playerCount: players.length,
      levelDistribution,
      avgHoursPerLevel:
        totalLevels > 0 ? Math.round(totalHours / totalLevels) : null,
    };
  }
}
