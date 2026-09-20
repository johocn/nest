import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SocialEconomyService } from './social-economy.service';
import { GameEvents } from '@event-bus/game-events';
import { SocialPointReason } from '@constants/enums';

@Injectable()
export class SocialEventListener {
  private readonly logger = new Logger(SocialEventListener.name);

  constructor(private readonly economyService: SocialEconomyService) {}

  @OnEvent(GameEvents.FRIEND_ADDED)
  async onFriendAdded(payload: { playerId: string; friendId: string }): Promise<void> {
    await this.safe(async () => {
      await this.economyService.earnPoints(payload.playerId, 10, SocialPointReason.FRIEND_ADDED, payload.friendId);
      await this.economyService.earnPoints(payload.friendId, 10, SocialPointReason.FRIEND_ADDED, payload.playerId);
    }, 'FRIEND_ADDED');
  }

  @OnEvent(GameEvents.KINSHIP_FORMED)
  async onKinshipFormed(payload: { kinshipId: string; type: string; leaderId: string; members: string[] }): Promise<void> {
    await this.safe(async () => {
      for (const m of payload.members) {
        await this.economyService.earnPoints(m, 30, SocialPointReason.KINSHIP_FORMED, payload.kinshipId);
      }
    }, 'KINSHIP_FORMED');
  }

  @OnEvent(GameEvents.GIFT_SENT)
  async onGiftSent(payload: { playerId: string; targetId: string; direction: string }): Promise<void> {
    await this.safe(async () => {
      if (payload.direction === 'send') {
        await this.economyService.earnPoints(payload.playerId, 5, SocialPointReason.GIFT_SENT, `g:${payload.targetId}`);
      }
    }, 'GIFT_SENT');
  }

  @OnEvent(GameEvents.GUILD_CONTRIB_GAINED)
  async onGuildContrib(payload: { playerId: string }): Promise<void> {
    await this.safe(async () => {
      await this.economyService.earnPoints(payload.playerId, 5, SocialPointReason.GUILD_CONTRIB);
    }, 'GUILD_CONTRIB');
  }

  @OnEvent(GameEvents.INTEL_GAINED)
  async onIntelGained(payload: { playerId: string; intelId: string }): Promise<void> {
    await this.safe(async () => {
      await this.economyService.earnPoints(payload.playerId, 10, SocialPointReason.INTEL_GAINED, payload.intelId);
    }, 'INTEL_GAINED');
  }

  @OnEvent(GameEvents.CHAT_SIGN_IN)
  async onChatSignIn(payload: { playerId: string; signInDate: string }): Promise<void> {
    await this.safe(async () => {
      await this.economyService.earnPoints(payload.playerId, 3, SocialPointReason.CHAT_SIGN_IN, payload.signInDate);
    }, 'CHAT_SIGN_IN');
  }

  private async safe(fn: () => Promise<void>, tag: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`Social point handler ${tag} failed`, (err as Error).message);
    }
  }
}
