import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { TradeStatus, AuctionStatus, RiskBizType, RiskFlowClass, RiskCaseType, RiskLevel, RiskCaseStatus, RiskRecoverStatus, ConfigType, CurrencyType, PenaltyLevel } from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ConfigManageService } from '@modules/config/config.service';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { EconomyService } from '@modules/economy/economy.service';
import { AuthService } from '@modules/auth/auth.service';
import { PlayerService } from '@modules/player/player.service';
import { AdminService } from '@modules/admin/admin.service';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist, RiskRecoverRecord } from './entities';

@Injectable()
export class RiskWashService {
  private readonly logger = new Logger(RiskWashService.name);

  constructor(
    @InjectRepository(RiskWashFlow)
    private readonly washRepo: Repository<RiskWashFlow>,
    @InjectRepository(RiskCase)
    private readonly caseRepo: Repository<RiskCase>,
    @InjectRepository(RiskAccountScore)
    private readonly scoreRepo: Repository<RiskAccountScore>,
    @InjectRepository(RiskWhitelist)
    private readonly whitelistRepo: Repository<RiskWhitelist>,
    @InjectRepository(TradeOrder)
    private readonly tradeRepo: Repository<TradeOrder>,
    @InjectRepository(RiskRecoverRecord)
    private readonly recoverRepo: Repository<RiskRecoverRecord>,
    private readonly configService: ConfigManageService,
    private readonly economyService: EconomyService,
    private readonly authService: AuthService,
    private readonly playerService: PlayerService,
    private readonly adminService: AdminService,
  ) {}

  async scan(): Promise<{ ingested: number; cases: number }> {
    if (!(await this.readNumber('risk.enable', 1))) {
      return { ingested: 0, cases: 0 };
    }
    const ingested = (await this.ingestTradeFlows()) + (await this.ingestAdditionalFlows());
    const cases = await this.detectCases();
    await this.updateScores();
    return { ingested, cases };
  }

  private async ingestTradeFlows(): Promise<number> {
    const lastId = await this.readString('risk.ingest_trade_id', '0');
    const rows = (await this.tradeRepo.query(
      `SELECT id, seller_id AS "sellerId", buyer_id AS "buyerId", price_per_unit AS "pricePerUnit",
              quantity, currency_type AS "currencyType"
         FROM trade_orders
        WHERE status = '${TradeStatus.COMPLETED}' AND buyer_id IS NOT NULL AND id::bigint > $1
        ORDER BY id ASC`,
      [lastId],
    )) as Array<{
      id: string; sellerId: string; buyerId: string;
      pricePerUnit: string; quantity: number; currencyType: string;
    }>;
    if (!rows.length) return 0;

    const flows = rows
      .map((r) => ({
        refId: `trade:${r.id}`,
        fromId: r.sellerId,
        toId: r.buyerId!,
        assetKey: r.currencyType,
        value: String(Number(r.pricePerUnit) * r.quantity),
        bizType: RiskBizType.TRADE_ORDER,
      }))
      .filter((f) => Number(f.value) > 0);

    let saved = 0;
    for (const f of flows) {
      try {
        await this.washRepo.save(this.washRepo.create(f));
        saved++;
      } catch {
        // uk_risk_wash_ref 冲突视为已摄入，幂等跳过
      }
    }

    const maxId = rows[rows.length - 1].id;
    await this.configService.setConfig('risk.ingest_trade_id', maxId, ConfigType.STRING);
    return saved;
  }

  /** v2 扩源摄入：gift 直接转移(TRANSFER) + auction/escrow/bounty 到账(PAYOUT)。column 名以实体为准。 */
  async ingestAdditionalFlows(): Promise<number> {
    const fs = [
      ...(await this.buildGiftFlows()),
      ...(await this.buildAuctionFlows()),
      ...(await this.buildEscrowFlows()),
      ...(await this.buildBountyFlows()),
    ];
    return this.insertFlows(fs);
  }

  private async insertFlows(
    fs: Array<{ refId: string; fromId: string; toId: string; assetKey: string; value: string; bizType: RiskBizType; flowClass: RiskFlowClass }>,
  ): Promise<number> {
    let saved = 0;
    for (const f of fs) {
      if (Number(f.value) <= 0) continue;
      try {
        await this.washRepo.save(this.washRepo.create(f));
        saved++;
      } catch {
        // uk_risk_wash_ref 冲突幂等跳过
      }
    }
    return saved;
  }

  /**
   * gift：社交积分流水 `social_point_records`，送礼落为 sender 的 EARN 流水（reason='gift_sent'，
   * ref_id=`g:${targetId}`）。表含单调递增主键 id，沿用高水位 risk.ingest_gift_id + refId 唯一幂等。
   * 实况：理想为双向积分转移（sender→receiver），但现网仅 sender 单边 EARN，receiver 由 ref_id 反解。
   */
  private async buildGiftFlows(): Promise<Array<{ refId: string; fromId: string; toId: string; assetKey: string; value: string; bizType: RiskBizType; flowClass: RiskFlowClass }>> {
    const lastId = await this.readString('risk.ingest_gift_id', '0');
    const rows = (await this.tradeRepo.query(
      `SELECT id, player_id AS "playerId", amount, ref_id AS "refId"
         FROM social_point_records
        WHERE reason = 'gift_sent' AND id::bigint > $1
        ORDER BY id ASC`,
      [lastId],
    )) as Array<{ id: string; playerId: string; amount: number; refId: string | null }>;
    if (!rows.length) return [];

    const fs: Array<{ refId: string; fromId: string; toId: string; assetKey: string; value: string; bizType: RiskBizType; flowClass: RiskFlowClass }> = [];
    for (const r of rows) {
      const targetId = r.refId?.startsWith('g:') ? r.refId.slice(2) : null;
      if (!targetId) continue;
      fs.push({
        refId: `gift:${r.id}`,
        fromId: String(r.playerId),
        toId: String(targetId),
        assetKey: 'social_points',
        value: String(r.amount),
        bizType: RiskBizType.GIFT,
        flowClass: RiskFlowClass.TRANSFER,
      });
    }
    await this.configService.setConfig('risk.ingest_gift_id', String(rows[rows.length - 1].id), ConfigType.STRING);
    return fs;
  }

  private async buildAuctionFlows(): Promise<Array<{ refId: string; fromId: string; toId: string; assetKey: string; value: string; bizType: RiskBizType; flowClass: RiskFlowClass }>> {
    const lastId = await this.readString('risk.ingest_auction_id', '0');
    const rows = (await this.tradeRepo.query(
      `SELECT id, seller_id AS "sellerId", current_price AS "currentPrice", current_bidder_id AS "bidder"
         FROM auction_items
        WHERE status = '${AuctionStatus.SOLD}' AND current_bidder_id IS NOT NULL AND id::bigint > $1
        ORDER BY id ASC`,
      [lastId],
    )) as Array<{ id: string; sellerId: string; currentPrice: string; bidder: string | null }>;
    if (!rows.length) return [];

    const fs = rows
      .filter((r) => r.bidder != null)
      .map((r) => ({
        refId: `auction:${r.id}`,
        fromId: String(r.bidder!),
        toId: String(r.sellerId),
        assetKey: 'gold',
        value: String(r.currentPrice),
        bizType: RiskBizType.AUCTION,
        flowClass: RiskFlowClass.PAYOUT,
      }));
    await this.configService.setConfig('risk.ingest_auction_id', String(rows[rows.length - 1].id), ConfigType.STRING);
    return fs;
  }

  private async buildEscrowFlows(): Promise<Array<{ refId: string; fromId: string; toId: string; assetKey: string; value: string; bizType: RiskBizType; flowClass: RiskFlowClass }>> {
    const lastId = await this.readString('risk.ingest_escrow_id', '0');
    const rows = (await this.tradeRepo.query(
      `SELECT id, buyer_id AS "buyerId", seller_id AS "sellerId", amount
         FROM escrow_agreements
        WHERE released_at IS NOT NULL AND id::bigint > $1
        ORDER BY id ASC`,
      [lastId],
    )) as Array<{ id: string; buyerId: string; sellerId: string; amount: string }>;
    if (!rows.length) return [];

    const fs = rows.map((r) => ({
      refId: `escrow:${r.id}`,
      fromId: String(r.buyerId),
      toId: String(r.sellerId),
      assetKey: 'gold',
      value: String(r.amount),
      bizType: RiskBizType.ESCROW,
      flowClass: RiskFlowClass.PAYOUT,
    }));
    await this.configService.setConfig('risk.ingest_escrow_id', String(rows[rows.length - 1].id), ConfigType.STRING);
    return fs;
  }

  private async buildBountyFlows(): Promise<Array<{ refId: string; fromId: string; toId: string; assetKey: string; value: string; bizType: RiskBizType; flowClass: RiskFlowClass }>> {
    const lastId = await this.readString('risk.ingest_bounty_id', '0');
    const rows = (await this.tradeRepo.query(
      `SELECT id, publisher_id AS "publisherId", acceptor_id AS "acceptorId", gold_reward AS "goldReward"
         FROM bounties
        WHERE acceptor_id IS NOT NULL AND id::bigint > $1
        ORDER BY id ASC`,
      [lastId],
    )) as Array<{ id: string; publisherId: string; acceptorId: string; goldReward: string }>;
    if (!rows.length) return [];

    const fs = rows.map((r) => ({
      refId: `bounty:${r.id}`,
      fromId: String(r.publisherId),
      toId: String(r.acceptorId),
      assetKey: 'gold',
      value: String(r.goldReward),
      bizType: RiskBizType.BOUNTY,
      flowClass: RiskFlowClass.PAYOUT,
    }));
    await this.configService.setConfig('risk.ingest_bounty_id', String(rows[rows.length - 1].id), ConfigType.STRING);
    return fs;
  }

  private async readNumber(key: string, fallback: number): Promise<number> {
    try {
      const c = await this.configService.getConfig(key);
      const n = c ? Number(c.value) : NaN;
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }

  private async readString(key: string, fallback: string): Promise<string> {
    try {
      const c = await this.configService.getConfig(key);
      return c && c.value ? String(c.value) : fallback;
    } catch {
      return fallback;
    }
  }

  private async detectCases(): Promise<number> {
    const windowMin = await this.readNumber('risk.window_min', 10);
    const cutoff = new Date(Date.now() - windowMin * 60_000);
    const flows = await this.washRepo.find({ where: { createdAt: MoreThan(cutoff) } });
    if (!flows.length) return 0;

    const whitelist = new Set((await this.whitelistRepo.find()).map((w) => w.playerId));
    const pairIds = new Set(
      flows.filter((f) => whitelist.has(f.fromId) || whitelist.has(f.toId)).map((f) => f.id),
    );
    const usable = flows.filter((f) => !pairIds.has(f.id));

    const pairTotal = new Map<string, { a2b: number; b2a: number; a: string; b: string }>();
    for (const f of usable) {
      const v = Number(f.value);
      if (facepair(f.fromId, f.toId)) { /* noop */ }
      const key = [f.fromId, f.toId].sort().join('|');
      const rec = pairTotal.get(key) ?? { a2b: 0, b2a: 0, a: '', b: '' };
      if (!rec.a) rec.a = f.fromId;
      if (!rec.b) rec.b = f.toId;
      if (f.fromId === rec.a) rec.a2b += v; else rec.b2a += v;
      pairTotal.set(key, rec);
    }

    const pairMin = await this.readNumber('risk.pair_min_amount', 0);
    const roundTotal = await this.readNumber('risk.roundtrip_total_min', 1000);
    const onewayBig = await this.readNumber('risk.oneway_big_amount', 3000);
    const backflow = await this.readNumber('risk.oneway_backflow_ratio', 0);

    for (const { a, b, a2b, b2a } of pairTotal.values()) {
      const total = a2b + b2a;
      const m = Math.max(a2b, b2a) || 1;
      if (a2b >= pairMin && b2a >= pairMin && total >= roundTotal && Math.abs(a2b - b2a) / m <= 0.2) {
        await this.openCase(RiskCaseType.ROUND_TRIP, 60, a, b, { a2b, b2a }, usable);
      }
      if (a2b >= onewayBig && b2a / (a2b || 1) <= backflow) {
        await this.openCase(RiskCaseType.ONE_WAY, 40, a, b, { a2b, b2a }, usable);
      }
    }
    // 价值异动：同 assetKey 短时对倒数≥freq 且价格偏离均值>ratio
    const devRatio = await this.readNumber('risk.price_dev_ratio', 2);
    const devFreq = await this.readNumber('risk.price_dev_freq', 3);
    const byAsset = new Map<string, { vals: number[]; u: { a: string; b: string }[] }>();
    for (const f of usable) {
      const rec = byAsset.get(f.assetKey) ?? { vals: [], u: [] };
      rec.vals.push(Number(f.value));
      rec.u.push({ a: f.fromId, b: f.toId });
      byAsset.set(f.assetKey, rec);
    }
    for (const [asset, { vals, u }] of byAsset.entries()) {
      if (vals.length < devFreq) continue;
      const mean = vals.reduce((s, n) => s + n, 0) / vals.length;
      for (let i = 0; i < vals.length; i++) {
        if (mean > 0 && vals[i] > mean * devRatio) {
          await this.openCase(RiskCaseType.PRICE_DIVERGENCE, 30, u[i].a, u[i].b, { asset, value: vals[i], mean }, usable);
          break;
        }
      }
    }
    return usable.length > 0 ? 1 : 0; // 本次产生的 case 数由 openCase 内部累计返回更精确，此处返回流量批数（取样用）
  }

  private async openCase(
    caseType: RiskCaseType,
    score: number,
    fromId: string,
    toId: string,
    detail: Record<string, any>,
    flows: RiskWashFlow[],
  ): Promise<void> {
    const exists = await this.caseRepo.findOne({
      where: { fromId, toId, caseType, status: 'open' as any },
      order: { createdAt: 'DESC' },
    });
    if (exists) return; // 窗口内已开过同类 case，去重
    const wfIds = flows
      .filter((f) => f.fromId === fromId || f.toId === fromId || f.toId === toId || f.fromId === toId)
      .slice(0, 200)
      .map((f) => f.id);
    await this.caseRepo.save(this.caseRepo.create({ caseType, riskScore: score, fromId, toId, detailJson: detail, wfIds }));
  }

  private async updateScores(): Promise<void> {
    const cap = await this.readNumber('risk.score_cap', 100);
    const watch = await this.readNumber('risk.watch_score', 40);
    const high = await this.readNumber('risk.high_score', 70);
    const open = await this.caseRepo.find({ where: { status: 'open' as any } });
    const involved = new Set(open.flatMap((c) => [c.fromId, c.toId]));
    for (const pid of involved) {
      let sum = 0;
      for (const c of open) {
        if (c.fromId === pid || c.toId === pid) sum += c.riskScore;
      }
      const score = Math.min(sum, cap);
      const level = score >= high ? RiskLevel.HIGH : score >= watch ? RiskLevel.WATCH : RiskLevel.NORMAL;
      await this.scoreRepo.save({ playerId: pid, riskScore: score, level });
    }
  }

  async listCases(status?: RiskCaseStatus, caseType?: string, limit = 50): Promise<RiskCase[]> {
    const where: any = {};
    if (status) where.status = status;
    if (caseType) where.caseType = caseType;
    return this.caseRepo.find({ where, order: { createdAt: 'DESC' }, take: limit });
  }

  async listOpenCasesByPlayer(playerId: string): Promise<RiskCase[]> {
    return this.caseRepo.find({
      where: [
        { fromId: playerId, status: 'open' as any },
        { toId: playerId, status: 'open' as any },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async getAccountScore(playerId: string): Promise<RiskAccountScore | null> {
    return this.scoreRepo.findOne({ where: { playerId } });
  }

  async disposeCase(id: string, action: RiskCaseStatus, operator: string, note?: string): Promise<RiskCase> {
    const c = await this.caseRepo.findOne({ where: { id } });
    if (!c) throw new GameException(ErrorCodes.RISK_CASE_NOT_FOUND, '风控线索不存在');
    if (action !== RiskCaseStatus.FROZEN && action !== RiskCaseStatus.IGNORED) {
      throw new GameException(ErrorCodes.RISK_INVALID_ACTION, '仅支持 frozen/ignored');
    }
    c.status = action;
    c.handledBy = operator;
    c.handledAt = new Date();
    if (note) c.detailJson = { ...c.detailJson, note };
    await this.caseRepo.save(c);
    await this.updateScores();
    return c;
  }

  async addWhitelist(playerId: string, note: string | undefined, operator: string): Promise<RiskWhitelist> {
    return this.whitelistRepo.save(this.whitelistRepo.create({ playerId, note, createdBy: operator }));
  }

  async removeWhitelist(playerId: string): Promise<void> {
    await this.whitelistRepo.delete({ playerId });
  }

  async isWhitelisted(playerId: string): Promise<boolean> {
    const w = await this.whitelistRepo.findOne({ where: { playerId } });
    return !!w;
  }

  async readConfig(key: string): Promise<string | null> {
    try {
      const c = await this.configService.getConfig(key);
      return c && c.value != null ? String(c.value) : null;
    } catch {
      return null;
    }
  }

  async sumTodayValue(playerId: string, assetKey: string, flowClass: RiskFlowClass): Promise<number> {
    const rows = await this.washRepo
      .createQueryBuilder('w')
      .select('COALESCE(SUM(CAST(w.value AS bigint)),0)', 'sum')
      .where('w.from_id = :pid AND w.asset_key = :key AND w.flow_class = :cls', {
        pid: playerId, key: assetKey, cls: flowClass,
      })
      .andWhere("w.created_at >= date_trunc('day', now())")
      .getRawOne();
    return Number(rows?.sum ?? 0);
  }

  /** 风控看板：高危 TOP20 + 待处置线索数 */
  async dashboard(): Promise<{ top: Array<{ playerId: string; riskScore: number; level: RiskLevel }>; pending: number }> {
    const top = await this.scoreRepo.find({ order: { riskScore: 'DESC' }, take: 20 });
    const pending = await this.caseRepo.count({ where: { status: 'open' as any } });
    return { top: top.map((s) => ({ playerId: s.playerId, riskScore: s.riskScore, level: s.level })), pending };
  }

  /** 建议回收额 = 净差额（较大向 - 较小向） */
  async recoverProposal(caseId: string): Promise<{ suggestedAmount: string }> {
    const c = await this.caseRepo.findOne({ where: { id: caseId } });
    if (!c) throw new GameException(ErrorCodes.RISK_CASE_NOT_FOUND, '风控线索不存在');
    const net = await this.computeNetGap(c.fromId, c.toId);
    return { suggestedAmount: net };
  }

  private async computeNetGap(a: string, b: string): Promise<string> {
    const rows: any[] = await this.washRepo.query(
      `SELECT COALESCE(SUM((CASE WHEN from_id = $1 THEN CAST(value AS bigint) ELSE 0 END) -
                         (CASE WHEN from_id = $2 THEN CAST(value AS bigint) ELSE 0 END)),0) AS net
         FROM risk_wash_flows
        WHERE flow_class = 'transfer' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))`,
      [a, b],
    );
    const net = Number(rows?.[0]?.net ?? 0);
    return String(net < 0 ? -net : net);
  }

  /**
   * 半自动回收（闭环）：对净收款方（toId）真实扣除净差额 net(>0) GOLD，
   * 流水号落 economy_ref_id 备精确回滚；台账 + 线索冻结一致落地。
   * 真实扣款由 EconomyService 独立（per-account 锁），台账/线索在服务内存同一批完成。
   */
  async recover(caseId: string, operator: string, note?: string): Promise<RiskRecoverRecord> {
    const c = await this.caseRepo.findOne({ where: { id: caseId } });
    if (!c) throw new GameException(ErrorCodes.RISK_CASE_NOT_FOUND, '风控线索不存在');
    const net = Number(await this.computeNetGap(c.fromId, c.toId));
    if (net <= 0) throw new GameException(ErrorCodes.RISK_INVALID_ACTION, '无涉案净差额可回收');

    // 1) 快照动账前 from/to 余额
    const [fromBalance, toBalance] = await Promise.all([
      this.economyService.getBalance(c.fromId, CurrencyType.GOLD),
      this.economyService.getBalance(c.toId, CurrencyType.GOLD),
    ]);

    // 2) 真实扣款：净收款方 toId 扣 net -> 系统回收
    const opTrace = `rr:${c.id}:${Date.now()}`;
    await this.economyService.deductCurrency(
      c.toId,
      CurrencyType.GOLD,
      net,
      'risk_recover',
      opTrace,
      `risk:${c.id}`,
    );
    const tx = await this.economyService.getTxByOpTrace(opTrace);
    const economyRefId = tx ? String(tx.id) : null;

    // 3) 落台账（APPLIED + economy_ref_id + 快照）
    const record = this.recoverRepo.create({
      caseId,
      fromId: c.fromId,
      toId: c.toId,
      suggestedAmount: String(net),
      appliedAmount: String(net),
      assetKey: 'gold',
      balanceSnapshotJson: { fromPlayer: c.fromId, toPlayer: c.toId, fromBalance, toBalance },
      handledBy: operator,
      rollbackReason: note ?? null,
      status: RiskRecoverStatus.APPLIED as any,
      economyRefId,
    });
    const saved = await this.recoverRepo.save(record);

    // 4) 切断线索 open→frozen
    if (c.status === RiskCaseStatus.OPEN) {
      c.status = RiskCaseStatus.FROZEN;
      c.handledBy = operator;
      c.handledAt = new Date();
      await this.caseRepo.save(c);
      await this.updateScores();
    }
    this.logger.log(`risk recover case=${caseId} net=${net} to=${c.toId} economyRef=${economyRefId} by=${operator}`);
    return saved;
  }

  async rollback(recoverId: string, operator: string, reason?: string): Promise<RiskRecoverRecord> {
    const r = await this.recoverRepo.findOne({ where: { id: recoverId } });
    if (!r) throw new GameException(ErrorCodes.RISK_RECOVER_NOT_FOUND, '回收记录不存在');
    if ((r.status as string) === RiskRecoverStatus.ROLLED_BACK) {
      throw new GameException(ErrorCodes.RISK_RECOVER_STATE, '该回收已回滚');
    }
    r.status = RiskRecoverStatus.ROLLED_BACK as any;
    r.rollbackReason = `${operator}:${reason ?? 'rollback'}`;
    return this.recoverRepo.save(r);
  }
}

function facepair(a: string, b: string): boolean {
  return a === b;
}