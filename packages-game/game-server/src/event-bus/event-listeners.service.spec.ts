import { Test } from '@nestjs/testing';
import { GameEventListeners } from './event-listeners.service';
import { QuestService } from '@modules/quest/quest.service';
import { PlayerService } from '@modules/player/player.service';
import { RankingService } from '@modules/ranking/ranking.service';
import { CharacterService } from '@modules/character/character.service';
import { WorldService } from '@modules/world/world.service';
import { DropService } from '@modules/item-drop/drop.service';
import { RankingType } from '@constants/enums';
import { AchievementService } from '@modules/achievement/achievement.service';
import { AchievementCondition } from '@constants/enums';

describe('GameEventListeners', () => {
  let listeners: GameEventListeners;
  let questService: jest.Mocked<any>;
  let playerService: jest.Mocked<any>;
  let rankingService: jest.Mocked<any>;
  let characterService: jest.Mocked<any>;
  let worldService: jest.Mocked<any>;
  let dropService: jest.Mocked<any>;
  let achievementService: jest.Mocked<any>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GameEventListeners,
        {
          provide: QuestService,
          useValue: { updateProgressByKill: jest.fn() },
        },
        {
          provide: PlayerService,
          useValue: {
            addExp: jest.fn(),
            addVipExp: jest.fn(),
            getById: jest.fn(),
          },
        },
        { provide: RankingService, useValue: { updateScore: jest.fn() } },
        { provide: CharacterService, useValue: { getById: jest.fn() } },
        { provide: WorldService, useValue: { getMonsterTemplate: jest.fn() } },
        { provide: DropService, useValue: { rollDrop: jest.fn() } },
        {
          provide: AchievementService,
          useValue: { advanceByCondition: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    listeners = moduleRef.get(GameEventListeners);
    questService = moduleRef.get(QuestService);
    playerService = moduleRef.get(PlayerService);
    rankingService = moduleRef.get(RankingService);
    characterService = moduleRef.get(CharacterService);
    worldService = moduleRef.get(WorldService);
    dropService = moduleRef.get(DropService);
    achievementService = moduleRef.get(AchievementService);
  });

  describe('onMonsterKilled', () => {
    it('should resolve character→player, update quest, roll drop, add exp', async () => {
      characterService.getById.mockResolvedValue({ playerId: 'p1' });
      worldService.getMonsterTemplate.mockResolvedValue({
        dropTemplateId: 'dt1',
      });
      dropService.rollDrop.mockResolvedValue([]);
      playerService.addExp.mockResolvedValue({ player: {}, leveledUp: false });

      await listeners.onMonsterKilled({
        attackerId: 'c1',
        defenderId: 'm1',
        sceneId: 's1',
      });

      expect(characterService.getById).toHaveBeenCalledWith('c1');
      expect(questService.updateProgressByKill).toHaveBeenCalledWith(
        'p1',
        'm1',
      );
      expect(worldService.getMonsterTemplate).toHaveBeenCalledWith('m1');
      expect(dropService.rollDrop).toHaveBeenCalledWith('p1', 'dt1');
      expect(playerService.addExp).toHaveBeenCalledWith('p1', 100);
    });

    it('should skip drop roll when monster has no dropTemplateId', async () => {
      characterService.getById.mockResolvedValue({ playerId: 'p1' });
      worldService.getMonsterTemplate.mockResolvedValue({
        dropTemplateId: null,
      });
      playerService.addExp.mockResolvedValue({ player: {}, leveledUp: false });

      await listeners.onMonsterKilled({
        attackerId: 'c1',
        defenderId: 'm1',
        sceneId: 's1',
      });

      expect(dropService.rollDrop).not.toHaveBeenCalled();
    });

    it('should continue with exp even if quest update fails', async () => {
      characterService.getById.mockResolvedValue({ playerId: 'p1' });
      worldService.getMonsterTemplate.mockResolvedValue(null);
      questService.updateProgressByKill.mockRejectedValue(
        new Error('quest error'),
      );
      playerService.addExp.mockResolvedValue({ player: {}, leveledUp: false });

      await listeners.onMonsterKilled({
        attackerId: 'c1',
        defenderId: 'm1',
        sceneId: 's1',
      });

      expect(playerService.addExp).toHaveBeenCalledWith('p1', 100);
    });

    it('should advance KILL_COUNT and WIN_COMBAT achievements for the parsed player', async () => {
      characterService.getById.mockResolvedValue({ playerId: 'p1' });
      worldService.getMonsterTemplate.mockResolvedValue(null);
      playerService.addExp.mockResolvedValue({ player: {}, leveledUp: false });

      await listeners.onMonsterKilled({
        attackerId: 'c1',
        defenderId: 'm1',
        sceneId: 's1',
      });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.KILL_COUNT,
        1,
      );
      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.WIN_COMBAT,
        1,
      );
    });

    it('should return early if character not found', async () => {
      characterService.getById.mockResolvedValue(null);

      await listeners.onMonsterKilled({
        attackerId: 'c1',
        defenderId: 'm1',
        sceneId: 's1',
      });

      expect(questService.updateProgressByKill).not.toHaveBeenCalled();
      expect(playerService.addExp).not.toHaveBeenCalled();
      expect(achievementService.advanceByCondition).not.toHaveBeenCalled();
    });
  });

  describe('onLevelUp', () => {
    it('should update ranking and set REACH_LEVEL achievement progress', async () => {
      playerService.getById.mockResolvedValue({ nickname: 'hero' });

      await listeners.onLevelUp({ playerId: 'p1', newLevel: 5 });

      expect(rankingService.updateScore).toHaveBeenCalledWith(
        RankingType.LEVEL,
        'p1',
        'hero',
        5,
      );
      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.REACH_LEVEL,
        5,
        'set',
      );
    });

    it('should use empty string if player not found', async () => {
      playerService.getById.mockResolvedValue(null);

      await listeners.onLevelUp({ playerId: 'p1', newLevel: 5 });

      expect(rankingService.updateScore).toHaveBeenCalledWith(
        RankingType.LEVEL,
        'p1',
        '',
        5,
      );
    });
  });

  describe('onRechargeSuccess', () => {
    it('should add VIP exp based on amount', async () => {
      playerService.addVipExp.mockResolvedValue({
        vipLevel: 1,
        vipExp: 100,
        leveledUp: false,
      });

      await listeners.onRechargeSuccess({
        playerId: 'p1',
        orderNo: 'o1',
        amount: '500',
      });

      expect(playerService.addVipExp).toHaveBeenCalledWith('p1', 500);
    });
  });

  describe('onCurrencyChanged', () => {
    it('should advance EARN_CURRENCY for positive changes', async () => {
      await listeners.onCurrencyChanged({
        playerId: 'p1',
        currencyType: 'gold',
        change: '100',
        source: 'recharge',
      });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.EARN_CURRENCY,
        100,
      );
    });

    it('should ignore non-positive changes', async () => {
      await listeners.onCurrencyChanged({
        playerId: 'p1',
        currencyType: 'gold',
        change: '-50',
        source: 'trade',
      });

      expect(achievementService.advanceByCondition).not.toHaveBeenCalled();
    });

    it('should ignore malformed change values', async () => {
      await listeners.onCurrencyChanged({
        playerId: 'p1',
        currencyType: 'gold',
        change: 'abc',
        source: 'trade',
      });

      expect(achievementService.advanceByCondition).not.toHaveBeenCalled();
    });
  });

  describe('onItemAcquired', () => {
    it('should log the item acquisition without throwing', async () => {
      await expect(
        listeners.onItemAcquired({
          playerId: 'p1',
          itemTemplateId: 'i1',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('onQuestCompleted', () => {
    it('should advance COMPLETE_QUEST', async () => {
      await listeners.onQuestCompleted({ playerId: 'p1' });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.COMPLETE_QUEST,
        1,
      );
    });
  });

  describe('onGuildJoined', () => {
    it('should advance JOIN_GUILD', async () => {
      await listeners.onGuildJoined({ guildId: 'g1', playerId: 'p1' });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.JOIN_GUILD,
        1,
      );
    });
  });

  describe('onFriendAdded', () => {
    it('should advance ADD_FRIEND', async () => {
      await listeners.onFriendAdded({ playerId: 'p1', friendId: 'p2' });

      expect(achievementService.advanceByCondition).toHaveBeenCalledWith(
        'p1',
        AchievementCondition.ADD_FRIEND,
        1,
      );
    });
  });
});
