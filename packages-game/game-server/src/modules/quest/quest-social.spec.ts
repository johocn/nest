import {
  SocialTargetType,
  QuestHelpStatus,
  QuestType,
  QuestStatus,
} from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import { getMetadataArgsStorage } from 'typeorm';
import { QuestTemplate } from './entities/quest-template.entity';
import { QuestHelpRequest } from './entities/quest-help-request.entity';

describe('Quest Social Domain Contracts', () => {
  it('should expose social quest enums', () => {
    expect(SocialTargetType.SPY).toBe('spy');
    expect(SocialTargetType.INQUIRE).toBe('inquire');
    expect(SocialTargetType.EAVESDROP).toBe('eavesdrop');
    expect(SocialTargetType.SEND_GIFT).toBe('send_gift');
    expect(SocialTargetType.RECIPROCATE_GIFT).toBe('reciprocate_gift');
    expect(SocialTargetType.ACCEPT_FRIEND).toBe('accept_friend');
    expect(SocialTargetType.FORM_KINSHIP).toBe('form_kinship');
    expect(SocialTargetType.DONATE_GUILD).toBe('donate_guild');
    expect(SocialTargetType.JOIN_GUILD).toBe('join_guild');
    expect(SocialTargetType.INTEL_BUY).toBe('intel_buy');
    expect(QuestHelpStatus.OPEN).toBe('open');
    expect(QuestHelpStatus.HELPED).toBe('helped');
    expect(QuestHelpStatus.CLOSED).toBe('closed');
  });

  it('should expose quest help error codes', () => {
    expect(ErrorCodes.QUEST_SOCIAL_PRE_REQ).toBe(91401);
    expect(ErrorCodes.QUEST_HELP_EXISTS).toBe(91402);
    expect(ErrorCodes.QUEST_HELP_NOT_FOUND).toBe(91403);
  });

  it('should expose GIFT_SENT event', () => {
    expect(GameEvents.GIFT_SENT).toBe('social.gift.sent');
  });

  it('should expose extended quest template columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === QuestTemplate,
    );
    const targetType = columns.find((c) => c.propertyName === 'targetType');
    expect(targetType).toBeDefined();
    expect((targetType.options as any).name).toBe('target_type');
    expect((targetType.options as any).type).toBe('varchar');
    const prerequisiteSocial = columns.find(
      (c) => c.propertyName === 'prerequisiteSocial',
    );
    expect(prerequisiteSocial).toBeDefined();
    expect((prerequisiteSocial.options as any).name).toBe('prerequisite_social');
    expect((prerequisiteSocial.options as any).type).toBe('jsonb');
    const rewardSocial = columns.find((c) => c.propertyName === 'rewardSocial');
    expect(rewardSocial).toBeDefined();
    expect((rewardSocial.options as any).name).toBe('reward_social');
    expect((rewardSocial.options as any).type).toBe('jsonb');
  });

  it('should expose quest help request entity', () => {
    expect(typeof QuestHelpRequest).toBe('function');
    expect(QuestType.MAIN).toBe('main');
    expect(QuestStatus.IN_PROGRESS).toBe('in_progress');
  });
});
