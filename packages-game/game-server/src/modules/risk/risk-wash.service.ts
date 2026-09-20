import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeStatus, RiskBizType, ConfigType } from '@constants/enums';
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

  // T4 填充
  private async detectCases(): Promise<number> {
    return 0;
  }

  // T4 填充
  private async updateScores(): Promise<void> {}
}