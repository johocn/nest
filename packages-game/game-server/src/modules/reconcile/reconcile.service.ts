import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Not, IsNull } from 'typeorm';
import { ReconcileResult } from './entities/reconcile-result.entity';
import {
  ReconcileType,
  AuctionStatus,
  TransactionType,
  TradeStatus,
} from '@constants/enums';
import { Transaction } from '@modules/economy/entities/transaction.entity';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { AuctionItem } from '@modules/trade/entities/auction-item.entity';
import { EscrowAgreement } from '@modules/trade/entities/escrow-agreement.entity';
import { Bounty } from '@modules/trade/entities/bounty.entity';

/** 一条预期结算流水（结算时应写出的资产入账） */
interface ExpectedFlow {
  bizId: string;
  playerId: string;
  txType: TransactionType;
  currencyType: string;
  amount: string;
  source: string;
}

type MismatchKind = 'MISSING_FLOW' | 'AMOUNT_MISMATCH' | 'DUPLICATE_REF';

interface MismatchDetail {
  bizId: string;
  type: MismatchKind;
  hint: string;
}

interface TypeTally {
  checked: number;
  mismatch: number;
  detailJson: MismatchDetail[];
}

/**
 * 日终对账「成交/拍卖/托管/悬赏」结算与资产流水一致性。
 * 统一口径：按业务 id 在 economy 流水里反查 related_id === 业务 id 的预期流水，
 * 检出 MISSING_FLOW / AMOUNT_MISMATCH / DUPLICATE_REF。只标记不自动动账。
 * 时间窗：以 statDate 至昨日（SQL now()-1 day）结算记录为对账对象，金额用 BigInt(numeric)。
 */
@Injectable()
export class ReconcileService {
  constructor(
    @InjectRepository(TradeOrder)
    private readonly tradeRepo: Repository<TradeOrder>,
    @InjectRepository(AuctionItem)
    private readonly auctionRepo: Repository<AuctionItem>,
    @InjectRepository(EscrowAgreement)
    private readonly escrowRepo: Repository<EscrowAgreement>,
    @InjectRepository(Bounty)
    private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,
    @InjectRepository(ReconcileResult)
    private readonly resultRepo: Repository<ReconcileResult>,
  ) {}

  /** 对 statDate（默认昨日）四类结算做日终对账，按日+类型幂等写表，返回 4 行结果 */
  async reconcileDaily(statDate?: string): Promise<ReconcileResult[]> {
    const stat = statDate ?? this.#defaultStatDate();
    const tallies: Array<{ type: ReconcileType; tally: TypeTally }> = [
      { type: ReconcileType.TRADE, tally: await this.#reconcileTrade(stat) },
      { type: ReconcileType.AUCTION, tally: await this.#reconcileAuction(stat) },
      { type: ReconcileType.ESCROW, tally: await this.#reconcileEscrow(stat) },
      { type: ReconcileType.BOUNTY, tally: await this.#reconcileBounty(stat) },
    ];
    const saved: ReconcileResult[] = [];
    for (const t of tallies) {
      saved.push(await this.#upsert(stat, t.type, t.tally));
    }
    return saved;
  }

  /** 结果列表（按日倒序，可选按类型过滤） */
  async listResults(reconcileType?: ReconcileType): Promise<ReconcileResult[]> {
    return this.resultRepo.find({
      where: reconcileType ? { reconcileType } : {},
      order: { statDate: 'DESC', reconcileType: 'ASC' },
    });
  }

  // ===== 四类结算对账 =====

  async #reconcileTrade(stat: string): Promise<TypeTally> {
    const orders = await this.tradeRepo.find({
      where: {
        status: TradeStatus.COMPLETED,
        updatedAt: Between(this.#dayStart(stat), this.#dayEnd(stat)),
      },
    });
    const tally = { checked: 0, mismatch: 0, detailJson: [] as MismatchDetail[] };
    for (const o of orders) {
      tally.checked++;
      const amount = (BigInt(o.pricePerUnit) * BigInt(o.quantity)).toString();
      this.#accumulate(
        tally,
        await this.#assertFlow(o.id, [
          {
            bizId: o.id,
            playerId: o.sellerId,
            txType: TransactionType.EARN,
            currencyType: o.currencyType,
            amount,
            source: 'trade',
          },
        ]),
      );
    }
    return tally;
  }

  async #reconcileAuction(stat: string): Promise<TypeTally> {
    const items = await this.auctionRepo.find({
      where: {
        status: AuctionStatus.SOLD,
        updatedAt: Between(this.#dayStart(stat), this.#dayEnd(stat)),
      },
    });
    const tally = { checked: 0, mismatch: 0, detailJson: [] as MismatchDetail[] };
    for (const item of items) {
      tally.checked++;
      this.#accumulate(
        tally,
        await this.#assertFlow(item.id, [
          {
            bizId: item.id,
            playerId: item.sellerId,
            txType: TransactionType.EARN,
            currencyType: 'gold',
            amount: item.currentPrice,
            source: 'auction',
          },
        ]),
      );
    }
    return tally;
  }

  async #reconcileEscrow(stat: string): Promise<TypeTally> {
    const escrows = await this.escrowRepo.find({
      where: {
        releasedAt: Between(this.#dayStart(stat), this.#dayEnd(stat)),
      },
    });
    const tally = { checked: 0, mismatch: 0, detailJson: [] as MismatchDetail[] };
    for (const e of escrows) {
      tally.checked++;
      const amount = BigInt(e.amount);
      const fee = (amount * BigInt(e.feePercent)) / BigInt(100);
      const expected: ExpectedFlow[] = [
        {
          bizId: e.id,
          playerId: e.sellerId,
          txType: TransactionType.EARN,
          currencyType: 'gold',
          amount: (amount - fee).toString(),
          source: 'escrow_release',
        },
      ];
      if (fee > BigInt(0)) {
        expected.push({
          bizId: e.id,
          playerId: e.guarantorId,
          txType: TransactionType.EARN,
          currencyType: 'gold',
          amount: fee.toString(),
          source: 'escrow_fee',
        });
      }
      this.#accumulate(tally, await this.#assertFlow(e.id, expected));
    }
    return tally;
  }

  async #reconcileBounty(stat: string): Promise<TypeTally> {
    const bounties = await this.bountyRepo.find({
      where: {
        acceptorId: Not(IsNull()),
        createdAt: Between(this.#dayStart(stat), this.#dayEnd(stat)),
      },
    });
    const tally = { checked: 0, mismatch: 0, detailJson: [] as MismatchDetail[] };
    for (const b of bounties) {
      tally.checked++;
      this.#accumulate(
        tally,
        await this.#assertFlow(b.id, [
          {
            bizId: b.id,
            playerId: b.acceptorId!,
            txType: TransactionType.EARN,
            currencyType: 'gold',
            amount: b.goldReward,
            source: 'bounty_reward',
          },
        ]),
      );
    }
    return tally;
  }

  // ===== 共享匹配逻辑 =====

  /** 按业务 id 反查流水，校验存在性 / 唯一性 / 金额一致性 */
  async #assertFlow(
    relatedId: string,
    expected: ExpectedFlow[],
  ): Promise<MismatchDetail[]> {
    const flows = await this.txRepo.find({ where: { relatedId } });
    const details: MismatchDetail[] = [];
    for (const exp of expected) {
      const matched = flows.filter(
        (f) =>
          f.txType === exp.txType &&
          f.currencyType === exp.currencyType &&
          f.playerId === exp.playerId &&
          f.source === exp.source,
      );
      if (matched.length === 0) {
        details.push({
          bizId: exp.bizId,
          type: 'MISSING_FLOW',
          hint: `expect ${exp.source} ref=${relatedId}`,
        });
        continue;
      }
      if (matched.length > 1) {
        details.push({
          bizId: exp.bizId,
          type: 'DUPLICATE_REF',
          hint: `source=${exp.source} ref=${relatedId} count=${matched.length}`,
        });
        continue;
      }
      const sum = matched.reduce((acc, f) => acc + BigInt(f.amount), 0n);
      if (sum !== BigInt(exp.amount)) {
        details.push({
          bizId: exp.bizId,
          type: 'AMOUNT_MISMATCH',
          hint: `expect ${exp.amount} got ${sum.toString()} source=${exp.source}`,
        });
      }
    }
    return details;
  }

  // ===== 汇总 & 幂等落表 =====

  #accumulate(tally: TypeTally, details: MismatchDetail[]): void {
    if (details.length > 0) {
      tally.mismatch++;
      tally.detailJson.push(...details);
    }
  }

  async #upsert(
    stat: string,
    type: ReconcileType,
    tally: TypeTally,
  ): Promise<ReconcileResult> {
    const existing = await this.resultRepo.findOne({
      where: { statDate: stat, reconcileType: type },
    });
    const data = {
      checked: tally.checked.toString(),
      mismatch: tally.mismatch.toString(),
      detailJson: (tally.detailJson as unknown) as Array<
        Record<string, string>
      >,
    };
    if (existing) {
      existing.checked = data.checked;
      existing.mismatch = data.mismatch;
      existing.detailJson = data.detailJson;
      return this.resultRepo.save(existing);
    }
    const row = this.resultRepo.create({
      statDate: stat,
      reconcileType: type,
      checked: data.checked,
      mismatch: data.mismatch,
      detailJson: data.detailJson,
    });
    return this.resultRepo.save(row);
  }

  // ===== 工具 =====

  #defaultStatDate(): string {
    return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  }

  #dayStart(stat: string): Date {
    return new Date(`${stat}T00:00:00`);
  }

  #dayEnd(stat: string): Date {
    return new Date(`${stat}T23:59:59.999`);
  }
}