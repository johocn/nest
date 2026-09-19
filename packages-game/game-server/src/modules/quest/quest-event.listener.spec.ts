import { Test, TestingModule } from '@nestjs/testing';
import { QuestEventListener } from './quest-event.listener';
import { QuestService } from './quest.service';
import { SocialTargetType } from '@constants/enums';

describe('QuestEventListener', () => {
  let listener: QuestEventListener;
  let questService: jest.Mocked<Pick<QuestService, 'advanceSocialTarget'>>;

  beforeEach(async () => {
    questService = { advanceSocialTarget: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestEventListener,
        { provide: QuestService, useValue: questService },
      ],
    }).compile();

    listener = module.get(QuestEventListener);
  });

  it('should map INTEL_GAINED inquire to inquire target', async () => {
    await listener.onIntelGained({ playerId: 'p1', sourceType: 'inquire' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.INQUIRE,
    );
  });

  it('should map INTEL_GAINED eavesdrop to eavesdrop target', async () => {
    await listener.onIntelGained({ playerId: 'p1', sourceType: 'eavesdrop' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.EAVESDROP,
    );
  });

  it('should map INTEL_GAINED spy or missing source to spy target', async () => {
    await listener.onIntelGained({ playerId: 'p1', sourceType: 'spy' });
    await listener.onIntelGained({ playerId: 'p1' });
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      1,
      'p1',
      SocialTargetType.SPY,
    );
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      2,
      'p1',
      SocialTargetType.SPY,
    );
  });

  it('should map GIFT_SENT reciprocate direction', async () => {
    await listener.onGiftSent({ playerId: 'p1', direction: 'reciprocate' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.RECIPROCATE_GIFT,
    );
  });

  it('should map GIFT_SENT send direction by default', async () => {
    await listener.onGiftSent({ playerId: 'p1', direction: 'send' });
    await listener.onGiftSent({ playerId: 'p1' });
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      1,
      'p1',
      SocialTargetType.SEND_GIFT,
    );
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      2,
      'p1',
      SocialTargetType.SEND_GIFT,
    );
  });

  it('should map FRIEND_ADDED to accept_friend target', async () => {
    await listener.onFriendAdded({ playerId: 'p1', friendId: 'p2' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.ACCEPT_FRIEND,
    );
  });

  it('should map GUILD_CONTRIB_GAINED to donate_guild target', async () => {
    await listener.onGuildContribGained({
      playerId: 'p1',
      guildId: 'g1',
      amount: 10,
    });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.DONATE_GUILD,
    );
  });

  it('should map KINSHIP_FORMED to form_kinship for leader and all members', async () => {
    await listener.onKinshipFormed({
      kinshipId: 'k1',
      type: 'sworn',
      leaderId: 'p1',
      members: ['p1', 'p2', 'p3'],
    });
    expect(questService.advanceSocialTarget).toHaveBeenCalledTimes(3);
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.FORM_KINSHIP,
    );
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p2',
      SocialTargetType.FORM_KINSHIP,
    );
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p3',
      SocialTargetType.FORM_KINSHIP,
    );
  });

  it('should not leak listener errors to main flow', async () => {
    questService.advanceSocialTarget.mockRejectedValue(
      new Error('boom'),
    );
    await expect(
      listener.onFriendAdded({ playerId: 'p1', friendId: 'p2' }),
    ).resolves.toBeUndefined();
  });

  it('should map ECO_ACTION view_article to view_article target', async () => {
    await listener.onEcoAction({ playerId: 'p1', action: 'view_article' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.VIEW_ARTICLE,
    );
  });

  it('should map ECO_ACTION course/product/price/activity views', async () => {
    await listener.onEcoAction({ playerId: 'p1', action: 'view_course' });
    await listener.onEcoAction({ playerId: 'p1', action: 'view_product' });
    await listener.onEcoAction({ playerId: 'p1', action: 'view_price' });
    await listener.onEcoAction({ playerId: 'p1', action: 'view_activity' });
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      1,
      'p1',
      SocialTargetType.VIEW_COURSE,
    );
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      2,
      'p1',
      SocialTargetType.VIEW_PRODUCT,
    );
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      3,
      'p1',
      SocialTargetType.VIEW_PRICE,
    );
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      4,
      'p1',
      SocialTargetType.VIEW_ACTIVITY,
    );
  });

  it('should map ECO_ACTION join/like/comment/purchase/distribute', async () => {
    await listener.onEcoAction({ playerId: 'p1', action: 'join_activity' });
    await listener.onEcoAction({ playerId: 'p1', action: 'like' });
    await listener.onEcoAction({ playerId: 'p1', action: 'comment' });
    await listener.onEcoAction({ playerId: 'p1', action: 'purchase' });
    await listener.onEcoAction({ playerId: 'p1', action: 'distribute' });
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      1,
      'p1',
      SocialTargetType.JOIN_ACTIVITY,
    );
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      2,
      'p1',
      SocialTargetType.LIKE,
    );
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      3,
      'p1',
      SocialTargetType.COMMENT,
    );
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      4,
      'p1',
      SocialTargetType.PURCHASE,
    );
    expect(questService.advanceSocialTarget).toHaveBeenNthCalledWith(
      5,
      'p1',
      SocialTargetType.DISTRIBUTE,
    );
  });

  it('should ignore unknown ECO_ACTION without advancing', async () => {
    await listener.onEcoAction({ playerId: 'p1', action: 'unknown' });
    expect(questService.advanceSocialTarget).not.toHaveBeenCalled();
  });

  it('should map FORMATION_ACTIVATED to activate_formation for leader', async () => {
    await listener.onFormationActivated({ formationId: 'f1', leaderId: 'p1' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.ACTIVATE_FORMATION,
    );
  });

  it('should map COMBO_TRIGGERED to perform_combo for attacker', async () => {
    await listener.onComboTriggered({ attackerId: 'p1', partnerId: 'p2' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.PERFORM_COMBO,
    );
  });

  it('should map RESCUE_SUCCESS to rescue_success for rescuer', async () => {
    await listener.onRescueSuccess({ rescuerId: 'p1', targetId: 'p2' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.RESCUE_SUCCESS,
    );
  });

  it('should map LOOT_DISTRIBUTED to loot_distributed for all players', async () => {
    await listener.onLootDistributed({
      combatLogId: 'c1',
      playersJson: [{ playerId: 'p1' }, { playerId: 'p2' }],
    });
    expect(questService.advanceSocialTarget).toHaveBeenCalledTimes(2);
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.LOOT_DISTRIBUTED,
    );
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p2',
      SocialTargetType.LOOT_DISTRIBUTED,
    );
  });

  it('should map ARBITRATION_SETTLED to arbitration_settled for both parties', async () => {
    await listener.onArbitrationSettled({
      arbitrationId: 'a1',
      partyA: 'p1',
      partyB: 'p2',
    });
    expect(questService.advanceSocialTarget).toHaveBeenCalledTimes(2);
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.ARBITRATION_SETTLED,
    );
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p2',
      SocialTargetType.ARBITRATION_SETTLED,
    );
  });

  it('should map GUILD_JOINED to join_guild target', async () => {
    await listener.onGuildJoined({ guildId: 'g1', playerId: 'p1' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.JOIN_GUILD,
    );
  });

  it('should map INTEL_BOUGHT to intel_buy target', async () => {
    await listener.onIntelBought({ playerId: 'p1' });
    expect(questService.advanceSocialTarget).toHaveBeenCalledWith(
      'p1',
      SocialTargetType.INTEL_BUY,
    );
  });

  it('should not leak eco handler errors to main flow', async () => {
    questService.advanceSocialTarget.mockRejectedValue(new Error('boom'));
    await expect(
      listener.onEcoAction({ playerId: 'p1', action: 'like' }),
    ).resolves.toBeUndefined();
  });
});
