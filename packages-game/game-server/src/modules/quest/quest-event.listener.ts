import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { QuestService } from './quest.service';
import { GameEvents } from '@event-bus/game-events';
import { SocialTargetType } from '@constants/enums';

@Injectable()
export class QuestEventListener {
  private readonly logger = new Logger(QuestEventListener.name);

  private static readonly ECO_TARGET_MAP: Record<string, SocialTargetType> = {
    view_article: SocialTargetType.VIEW_ARTICLE,
    view_course: SocialTargetType.VIEW_COURSE,
    view_product: SocialTargetType.VIEW_PRODUCT,
    view_price: SocialTargetType.VIEW_PRICE,
    view_activity: SocialTargetType.VIEW_ACTIVITY,
    join_activity: SocialTargetType.JOIN_ACTIVITY,
    like: SocialTargetType.LIKE,
    comment: SocialTargetType.COMMENT,
    purchase: SocialTargetType.PURCHASE,
    distribute: SocialTargetType.DISTRIBUTE,
  };

  constructor(private readonly questService: QuestService) {}

  @OnEvent(GameEvents.ECO_ACTION)
  async onEcoAction(payload: {
    playerId: string;
    action: string;
  }): Promise<void> {
    try {
      const targetType = QuestEventListener.ECO_TARGET_MAP[payload.action];
      if (!targetType) return;
      await this.questService.advanceSocialTarget(payload.playerId, targetType);
    } catch (err) {
      this.logger.error('Eco action handler failed', (err as Error).message);
    }
  }

  @OnEvent(GameEvents.FORMATION_ACTIVATED)
  async onFormationActivated(payload: { leaderId: string }): Promise<void> {
    try {
      await this.questService.advanceSocialTarget(
        payload.leaderId,
        SocialTargetType.ACTIVATE_FORMATION,
      );
    } catch (err) {
      this.logger.error(
        'Formation activated handler failed',
        (err as Error).message,
      );
    }
  }

  @OnEvent(GameEvents.COMBO_TRIGGERED)
  async onComboTriggered(payload: { attackerId: string }): Promise<void> {
    try {
      await this.questService.advanceSocialTarget(
        payload.attackerId,
        SocialTargetType.PERFORM_COMBO,
      );
    } catch (err) {
      this.logger.error(
        'Combo triggered handler failed',
        (err as Error).message,
      );
    }
  }

  @OnEvent(GameEvents.RESCUE_SUCCESS)
  async onRescueSuccess(payload: { rescuerId: string }): Promise<void> {
    try {
      await this.questService.advanceSocialTarget(
        payload.rescuerId,
        SocialTargetType.RESCUE_SUCCESS,
      );
    } catch (err) {
      this.logger.error(
        'Rescue success handler failed',
        (err as Error).message,
      );
    }
  }

  @OnEvent(GameEvents.LOOT_DISTRIBUTED)
  async onLootDistributed(payload: {
    playersJson: Array<{ playerId: string }>;
  }): Promise<void> {
    const playerIds = (payload.playersJson ?? [])
      .map((p) => p?.playerId)
      .filter((id): id is string => typeof id === 'string');
    for (const playerId of playerIds) {
      try {
        await this.questService.advanceSocialTarget(
          playerId,
          SocialTargetType.LOOT_DISTRIBUTED,
        );
      } catch (err) {
        this.logger.error(
          'Loot distributed handler failed',
          (err as Error).message,
        );
      }
    }
  }

  @OnEvent(GameEvents.ARBITRATION_SETTLED)
  async onArbitrationSettled(payload: {
    partyA?: string;
    partyB?: string;
  }): Promise<void> {
    const playerIds = [...new Set([payload.partyA, payload.partyB])].filter(
      (id): id is string => typeof id === 'string',
    );
    for (const playerId of playerIds) {
      try {
        await this.questService.advanceSocialTarget(
          playerId,
          SocialTargetType.ARBITRATION_SETTLED,
        );
      } catch (err) {
        this.logger.error(
          'Arbitration settled handler failed',
          (err as Error).message,
        );
      }
    }
  }

  @OnEvent(GameEvents.GUILD_JOINED)
  async onGuildJoined(payload: { playerId: string }): Promise<void> {
    try {
      await this.questService.advanceSocialTarget(
        payload.playerId,
        SocialTargetType.JOIN_GUILD,
      );
    } catch (err) {
      this.logger.error('Guild joined handler failed', (err as Error).message);
    }
  }

  @OnEvent(GameEvents.INTEL_BOUGHT)
  async onIntelBought(payload: { playerId: string }): Promise<void> {
    try {
      await this.questService.advanceSocialTarget(
        payload.playerId,
        SocialTargetType.INTEL_BUY,
      );
    } catch (err) {
      this.logger.error('Intel bought handler failed', (err as Error).message);
    }
  }

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
