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
});
