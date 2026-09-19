import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { QuestService } from './quest.service';
import { GameEvents } from '@event-bus/game-events';
import { SocialTargetType } from '@constants/enums';

@Injectable()
export class QuestEventListener {
  private readonly logger = new Logger(QuestEventListener.name);

  constructor(private readonly questService: QuestService) {}

  @OnEvent(GameEvents.INTEL_GAINED)
  async onIntelGained(payload: { playerId: string; sourceType?: string }) {
    try {
      const targetType =
        payload.sourceType === 'inquire'
          ? SocialTargetType.INQUIRE
          : payload.sourceType === 'eavesdrop'
            ? SocialTargetType.EAVESDROP
            : SocialTargetType.SPY;
      await this.questService.advanceSocialTarget(payload.playerId, targetType);
    } catch (err) {
      this.logger.error('Intel gained handler failed', (err as Error).message);
    }
  }

  @OnEvent(GameEvents.GIFT_SENT)
  async onGiftSent(payload: { playerId: string; direction?: string }) {
    try {
      const targetType =
        payload.direction === 'reciprocate'
          ? SocialTargetType.RECIPROCATE_GIFT
          : SocialTargetType.SEND_GIFT;
      await this.questService.advanceSocialTarget(payload.playerId, targetType);
    } catch (err) {
      this.logger.error('Gift sent handler failed', (err as Error).message);
    }
  }

  @OnEvent(GameEvents.FRIEND_ADDED)
  async onFriendAdded(payload: { playerId: string }) {
    try {
      await this.questService.advanceSocialTarget(
        payload.playerId,
        SocialTargetType.ACCEPT_FRIEND,
      );
    } catch (err) {
      this.logger.error('Friend added handler failed', (err as Error).message);
    }
  }

  @OnEvent(GameEvents.GUILD_CONTRIB_GAINED)
  async onGuildContribGained(payload: { playerId: string }) {
    try {
      await this.questService.advanceSocialTarget(
        payload.playerId,
        SocialTargetType.DONATE_GUILD,
      );
    } catch (err) {
      this.logger.error(
        'Guild contrib gained handler failed',
        (err as Error).message,
      );
    }
  }

  @OnEvent(GameEvents.KINSHIP_FORMED)
  async onKinshipFormed(payload: { leaderId: string; members: string[] }) {
    const playerIds = [...new Set([payload.leaderId, ...(payload.members ?? [])])];
    for (const playerId of playerIds) {
      try {
        await this.questService.advanceSocialTarget(
          playerId,
          SocialTargetType.FORM_KINSHIP,
        );
      } catch (err) {
        this.logger.error(
          'Kinship formed handler failed',
          (err as Error).message,
        );
      }
    }
  }
}
