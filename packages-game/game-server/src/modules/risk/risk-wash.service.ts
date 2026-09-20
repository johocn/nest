import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { TradeStatus, RiskBizType, RiskCaseType, RiskLevel, RiskCaseStatus, ConfigType } from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ConfigManageService } from '@modules/config/config.service';
import { TradeOrder } from '@modules/trade/entities/trade-order.entity';
import { RiskWashFlow, RiskCase, RiskAccountScore, RiskWhitelist } from './entities';

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
    private readonly configService: ConfigManageService,
  ) {}

  async scan(): Promise<{ ingested: number; cases: number }> {
    if (!(await this.readNumber('risk.enable', 1))) {
      return { ingested: 0, cases: 0 };
    }
    const ingested = await this.ingestTradeFlows();
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
}

function facepair(a: string, b: string): boolean {
  return a === b;
}