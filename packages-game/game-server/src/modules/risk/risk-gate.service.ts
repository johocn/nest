import { Injectable } from '@nestjs/common';
import { RiskWashService } from './risk-wash.service';
import { RiskLevel, RiskFlowClass } from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@Injectable()
export class RiskGateService {
  constructor(private readonly riskWashService: RiskWashService) {}

  /** 拍卖上架前校验：高危且起拍价超 cap 阻断（93202） */
  async assertAuction(playerId: string, startPrice: string, assetKey = 'gold'): Promise<void> {
    const sc = await this.riskWashService.getAccountScore(playerId);
    if (!sc || sc.level !== RiskLevel.HIGH) return;
    if (await this.riskWashService.isWhitelisted(playerId)) return;
    const cap = await this.readCap('risk.auction_value_cap', 500_0000_0000);
    if (Number(startPrice) > cap) {
      throw new GameException(ErrorCodes.RISK_BLOCKED_AUCTION, '高风险账号，拍卖上架受限');
    }
  }

  /** 礼物/转账前校验：高危且单笔超 cap 阻断（93201） */
  async assertTransfer(playerId: string, amount: string, assetKey: string): Promise<void> {
    if (Number(amount) <= 0) return;
    const sc = await this.riskWashService.getAccountScore(playerId);
    if (!sc || sc.level !== RiskLevel.HIGH) return;
    if (await this.riskWashService.isWhitelisted(playerId)) return;
    const dailyCap = await this.readCap(
      assetKey === 'social_points' ? 'risk.gift_daily_cap' : 'risk.transfer_daily_cap',
      500_0000_0000,
    );
    const today = await this.riskWashService.sumTodayValue(playerId, assetKey, RiskFlowClass.TRANSFER);
    if (today + Number(amount) > dailyCap) {
      throw new GameException(ErrorCodes.RISK_BLOCKED_TRANSFER, '高风险账号，转账/送礼额度受限');
    }
  }

  /** 读取 risk.* 配置，缺省回退 fallback */
  private async readCap(key: string, fallback: number): Promise<number> {
    try {
      const c = await this.riskWashService.readConfig(key);
      const n = c ? Number(c) : NaN;
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  }
}