import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GameEvents } from '@event-bus/game-events';
import { CurrencyType } from '@constants/enums';
import { LadderService } from '@modules/ladder/ladder.service';
import { EconomyService } from '@modules/economy/economy.service';
import { PlayerService } from '@modules/player/player.service';

/**
 * 斗地主对局结束后的权威结算（监听 DOUDIZHU_TABLE_FINISHED）：
 *  - 三方段位（ladder 地主 vs 两农民）
 *  - 欢乐豆：复用 GOLD 货币（避免新增 DB enum 列），胜加负扣
 *  - 经验：按 |得分| 加 exp
 * 任一人结算失败不影响其余玩家。
 */
@Injectable()
export class DoudizhuSettlementService {
  private readonly logger = new Logger(DoudizhuSettlementService.name);

  constructor(
    private readonly ladder: LadderService,
    private readonly economy: EconomyService,
    private readonly player: PlayerService,
  ) {}

  @OnEvent(GameEvents.DOUDIZHU_TABLE_FINISHED)
  async onFinished(payload: {
    tableId: string;
    seats: { seat: number; playerId: string }[];
    scores: number[];
    landlordSeat: number;
    landlordWin: boolean;
    baseScore: number;
    multiplier: number;
  }): Promise<void> {
    try {
      // 1) 三方段位
      await this.ladder.settleDoudizhu(payload);

      // 2) 欢乐豆（GOLD 复用）+ 经验
      for (const { seat, playerId } of payload.seats) {
        const delta = payload.scores[seat] ?? 0;
        const opTrace = `doudizhu:${payload.tableId}:${seat}`;
        try {
          if (delta > 0) {
            await this.economy.addCurrency(
              playerId,
              CurrencyType.GOLD,
              delta,
              'doudizhu',
              opTrace,
            );
          } else if (delta < 0) {
            await this.economy.deductCurrency(
              playerId,
              CurrencyType.GOLD,
              -delta,
              'doudizhu',
              opTrace,
            );
          }
          await this.player.addExp(playerId, Math.max(1, Math.abs(delta)));
        } catch (err: any) {
          this.logger.warn(
            `[settlement] player ${playerId} currency/exp failed: ${err?.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(
        `[settlement] doudizhu ${payload?.tableId} failed: ${err?.message}`,
      );
    }
  }
}
