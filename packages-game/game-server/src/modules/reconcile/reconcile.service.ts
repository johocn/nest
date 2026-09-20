import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReconcileResult } from './entities/reconcile-result.entity';
import { ReconcileType } from '@constants/enums';
import { Transaction } from '@modules/economy/entities/transaction.entity';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { AuctionItem } from '@modules/trade/entities/auction-item.entity';
import { EscrowAgreement } from '@modules/trade/entities/escrow-agreement.entity';
import { Bounty } from '@modules/trade/entities/bounty.entity';

/**
 * 日终对账「成交/拍卖/托管/悬赏」结算与资产流水一致性。
 * 统一口径：按业务 id 在 economy 流水里反查 related_id === 业务 id 的预期流水，
 * 检出 MISSING_FLOW / AMOUNT_MISMATCH / DUPLICATE_REF。只标记不自动动账。
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

  async reconcileDaily(statDate?: string): Promise<ReconcileResult[]> {
    // T2 实现
    throw new Error('reconcileDaily not implemented');
  }
}