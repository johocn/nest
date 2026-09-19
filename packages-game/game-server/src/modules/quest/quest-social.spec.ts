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

  it('should expose game-added social target types', () => {
    expect(SocialTargetType.FORM_FORMATION).toBe('form_formation');
    expect(SocialTargetType.ACTIVATE_FORMATION).toBe('activate_formation');
    expect(SocialTargetType.PERFORM_COMBO).toBe('perform_combo');
    expect(SocialTargetType.RESCUE_SUCCESS).toBe('rescue_success');
    expect(SocialTargetType.LOOT_DISTRIBUTED).toBe('loot_distributed');
    expect(SocialTargetType.ARBITRATION_SETTLED).toBe('arbitration_settled');
    expect(SocialTargetType.NEGOTIATION_DONE).toBe('negotiation_done');
    expect(SocialTargetType.ESCROW_RELEASED).toBe('escrow_released');
    expect(SocialTargetType.BOUNTY_PUBLISHED).toBe('bounty_published');
    expect(SocialTargetType.BOUNTY_COMPLETED).toBe('bounty_completed');
    expect(SocialTargetType.CREDIT_REPAID).toBe('credit_repaid');
    expect(SocialTargetType.BARTER_DONE).toBe('barter_done');
  });

  it('should expose eco target types', () => {
    expect(SocialTargetType.VIEW_ARTICLE).toBe('view_article');
    expect(SocialTargetType.VIEW_COURSE).toBe('view_course');
    expect(SocialTargetType.VIEW_PRODUCT).toBe('view_product');
    expect(SocialTargetType.VIEW_PRICE).toBe('view_price');
    expect(SocialTargetType.VIEW_ACTIVITY).toBe('view_activity');
    expect(SocialTargetType.JOIN_ACTIVITY).toBe('join_activity');
    expect(SocialTargetType.LIKE).toBe('like');
    expect(SocialTargetType.COMMENT).toBe('comment');
    expect(SocialTargetType.PURCHASE).toBe('purchase');
    expect(SocialTargetType.DISTRIBUTE).toBe('distribute');
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
