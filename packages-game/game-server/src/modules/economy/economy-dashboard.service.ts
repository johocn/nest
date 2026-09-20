import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from './entities/transaction.entity';
import { PlayerCurrency } from '@modules/player/entities/player-currency.entity';
import { RiskRecoverRecord } from '@modules/risk/entities/risk-recover-record.entity';
import { CurrencyType, TransactionType, AccountStatus, RiskRecoverStatus } from '@constants/enums';

export interface EconomyDashboardSnapshot {
  currencyStats: {
    totalGold: string;
    inflow7d: string;
    outflow7d: string;
    /** 净增量 = 近7日金币流入 - 流出（>0 通胀 / <0 通缩） */
    netChange7d: string;
  };
  assetDistribution: {
    /** 近似的余额总量、分布分位与活跃账号数（默认只统计正余额，去 0 冷数据噪音） */
    p50: string;
    p90: string;
    max: string;
    activeCount: number;
  };
  /** 被 BAN / TRADE_LIMIT 惩罚账号的持仓冻结量（金币） */
  frozenAmount: string;
  /** 风控已回收总额（risk_recover_records 累计 APPLIED appliedAmount） */
  recoveryToDate: string;
}

/**
 * GM 经济宏观聚合看板（只读）
 *
 * 数据源：
 * - 金总量 / 资产分布 / 冻结量来自 `player_currencies`（余额权威来源）
 * - 近 7 日 产出-消耗来自交易流水 `transactions`
 * - 回收额来自 `risk_recover_records`
 * 全部为只读 createQueryBuilder 聚合，不落临时表、不写业务数据。
 * 金额用 numeric 求和避免 float 误差；时间窗统一走 SQL 端 now()。
 */
@Injectable()
export class EconomyDashboardService {
  constructor(
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,
    @InjectRepository(PlayerCurrency)
    private readonly balanceRepo: Repository<PlayerCurrency>,
    @InjectRepository(RiskRecoverRecord)
    private readonly recoverRepo: Repository<RiskRecoverRecord>,
  ) {}

  async dashboard(): Promise<EconomyDashboardSnapshot> {
    // 1) 金总量(余额来源)
    const total = await this.balanceRepo
      .createQueryBuilder('pc')
      .select('COALESCE(SUM(CAST(pc.amount AS numeric)),0)', 'total')
      .where('pc.currency_type = :gold', { gold: CurrencyType.GOLD })
      .getRawOne();

    // 2) 近 7 日金币 产出(in) / 消耗(out)
    const flow = await this.txRepo
      .createQueryBuilder('t')
      .select(
        "COALESCE(SUM(CASE WHEN t.tx_type = :earn THEN CAST(t.amount AS numeric) ELSE 0 END),0)",
        'inflow',
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN t.tx_type = :spend THEN -CAST(t.amount AS numeric) ELSE 0 END),0)",
        'outflow',
      )
      .where(
        "t.currency_type = :gold AND t.created_at >= now() - interval '7 days'",
        { gold: CurrencyType.GOLD },
      )
      .setParameters({ earn: TransactionType.EARN, spend: TransactionType.SPEND })
      .getRawOne();

    // 3) 资产分布：P50/P90/max/活跃账号数（正整数余额样本，去 0）
    const dist = await this.balanceRepo
      .createQueryBuilder('pc')
      .select(
        'COALESCE(COUNT(DISTINCT pc.player_id) FILTER (WHERE CAST(pc.amount AS numeric) > 0),0)',
        'activeCount',
      )
      .addSelect(
        'COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CAST(pc.amount AS numeric) DESC),0)',
        'p50',
      )
      .addSelect(
        'COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY CAST(pc.amount AS numeric) DESC),0)',
        'p90',
      )
      .addSelect('COALESCE(MAX(CAST(pc.amount AS numeric)),0)', 'max')
      .where('pc.currency_type = :gold', { gold: CurrencyType.GOLD })
      .getRawOne();

    // 4) 惩罚账号持仓冻结量：BAN(status=banned) 或 生效中的 TRADE_LIMIT(trade_locked_until>now())
    const frozen = await this.balanceRepo
      .createQueryBuilder('pc')
      .select('COALESCE(SUM(CAST(pc.amount AS numeric)),0)', 'frozen')
      .innerJoin('auth_accounts', 'a', 'a.id = (select account_id from players p0 where p0.id = pc.player_id)')
      .where('pc.currency_type = :gold', { gold: CurrencyType.GOLD })
      .andWhere(
        'a.status = :banned OR (a.trade_locked_until IS NOT NULL AND a.trade_locked_until > now())',
        { banned: AccountStatus.BANNED },
      )
      .getRawOne();

    // 5) 风控已回收总额（APPLIED 状态累计）
    const recovery = await this.recoverRepo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(CAST(r.applied_amount AS numeric)),0)', 'applied')
      .where('r.status = :applied', { applied: RiskRecoverStatus.APPLIED })
      .getRawOne();

    return {
      currencyStats: {
        totalGold: String(total?.total ?? 0),
        inflow7d: String(flow?.inflow ?? 0),
        outflow7d: String(flow?.outflow ?? 0),
        netChange7d: String(
          (Number(flow?.inflow ?? 0) || 0) - (Number(flow?.outflow ?? 0) || 0),
        ),
      },
      assetDistribution: {
        p50: String(dist?.p50 ?? 0),
        p90: String(dist?.p90 ?? 0),
        max: String(dist?.max ?? 0),
        activeCount: Number(dist?.activeCount ?? 0),
      },
      frozenAmount: String(frozen?.frozen ?? 0),
      recoveryToDate: String(recovery?.applied ?? 0),
    };
  }
}