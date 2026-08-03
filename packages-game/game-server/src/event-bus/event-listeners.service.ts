import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { QuestService } from '@modules/quest/quest.service';
import { PlayerService } from '@modules/player/player.service';
import { RankingService } from '@modules/ranking/ranking.service';
import { CharacterService } from '@modules/character/character.service';
import { WorldService } from '@modules/world/world.service';
import { DropService } from '@modules/item-drop/drop.service';
import { GameEvents } from './game-events';
import { RankingType } from '@constants/enums';

@Injectable()
export class GameEventListeners {
  private readonly logger = new Logger(GameEventListeners.name);

  constructor(
    private readonly questService: QuestService,
    private readonly playerService: PlayerService,
    private readonly rankingService: RankingService,
    private readonly characterService: CharacterService,
    private readonly worldService: WorldService,
    private readonly dropService: DropService,
  ) {}

  @OnEvent(GameEvents.MONSTER_KILLED)
  async onMonsterKilled(payload: {
    attackerId: string;
    defenderId: string;
    sceneId: string;
  }) {
    this.logger.log(
      `Monster killed: attacker=${payload.attackerId}, defender=${payload.defenderId}`,
    );
    try {
      // Resolve character ID → player ID
      const character = await this.characterService.getById(payload.attackerId);
      if (!character || !character.playerId) {
        this.logger.warn(
          `No character/player found for attacker ${payload.attackerId}`,
        );
        return;
      }
      const playerId = character.playerId;

      // Update quest progress (defenderId is the monster entity ID, use as monsterTemplateId for matching)
      try {
        await this.questService.updateProgressByKill(
          playerId,
          payload.defenderId,
        );
      } catch (err) {
        this.logger.error(
          'Quest progress update failed',
          (err as Error).message,
        );
      }

      // Roll drops via MonsterTemplate.dropTemplateId
      try {
        const monsterTemplate = await this.worldService.getMonsterTemplate(
          payload.defenderId,
        );
        if (monsterTemplate?.dropTemplateId) {
          await this.dropService.rollDrop(
            playerId,
            monsterTemplate.dropTemplateId,
          );
        }
      } catch (err) {
        this.logger.error('Drop roll failed', (err as Error).message);
      }

      // Add exp for the kill
      try {
        await this.playerService.addExp(playerId, 100);
      } catch (err) {
        this.logger.error('Exp add failed', (err as Error).message);
      }
    } catch (err) {
      this.logger.error(
        'Monster killed handler failed',
        (err as Error).message,
      );
    }
  }

  @OnEvent(GameEvents.LEVEL_UP)
  async onLevelUp(payload: { playerId: string; newLevel: number }) {
    this.logger.log(
      `Player leveled up: ${payload.playerId} → level ${payload.newLevel}`,
    );
    try {
      const player = await this.playerService.getById(payload.playerId);
      const playerName = player?.nickname ?? '';
      await this.rankingService.updateScore(
        RankingType.LEVEL,
        payload.playerId,
        playerName,
        payload.newLevel,
      );
    } catch (err) {
      this.logger.error('Ranking update failed', (err as Error).message);
    }
  }

  @OnEvent(GameEvents.CURRENCY_CHANGED)
  async onCurrencyChanged(payload: {
    playerId: string;
    currencyType: string;
    change: string;
    source: string;
  }) {
    this.logger.debug(
      `Currency changed: ${payload.playerId} ${payload.currencyType} ${payload.change} source=${payload.source}`,
    );
    // Achievement progress update would go here — needs achievementId mapping
  }

  @OnEvent(GameEvents.ITEM_ACQUIRED)
  async onItemAcquired(payload: { playerId: string; itemTemplateId: string }) {
    this.logger.debug(
      `Item acquired: ${payload.playerId} item=${payload.itemTemplateId}`,
    );
    // Achievement progress update would go here
  }

  @OnEvent(GameEvents.RECHARGE_SUCCESS)
  async onRechargeSuccess(payload: {
    playerId: string;
    orderNo: string;
    amount: string;
    reward?: Record<string, any>;
  }) {
    this.logger.log(
      `Recharge success: ${payload.playerId} order=${payload.orderNo}`,
    );
    try {
      await this.playerService.addVipExp(
        payload.playerId,
        Number(payload.amount),
      );
    } catch (err) {
      this.logger.error('VIP exp add failed', (err as Error).message);
    }
  }
}
