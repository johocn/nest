import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VipService } from './vip.service';
import { GameEvents } from '@event-bus/game-events';

@Injectable()
export class VipEventListener {
  private readonly logger = new Logger(VipEventListener.name);

  constructor(private readonly vipService: VipService) {}

  @OnEvent(GameEvents.VIP_LEVEL_UP)
  async onVipLevelUp(payload: { playerId: string; newVipLevel: number }): Promise<void> {
    try {
      await this.vipService.grantVipTitleIfEligible(payload.playerId);
    } catch (err) {
      this.logger.error(
        `grant vip title failed for player ${payload.playerId}`,
        (err as Error).message,
      );
    }
  }
}
