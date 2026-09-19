import {
  NegotiationStatus,
  EscrowStatus,
  BountyStatus,
  CreditStatus,
  BarterStatus,
} from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import {
  Negotiation,
  EscrowAgreement,
  Bounty,
  CreditDebt,
  BarterDeal,
} from './entities';
import { getMetadataArgsStorage } from 'typeorm';

describe('Social Economy Domain Contracts', () => {
  it('should expose social economy enums', () => {
    expect(NegotiationStatus.PENDING).toBe('pending');
    expect(NegotiationStatus.COMPLETED).toBe('completed');
    expect(NegotiationStatus.EXPIRED).toBe('expired');
    expect(NegotiationStatus.LOCKED).toBe('locked');
    expect(EscrowStatus.PENDING).toBe('pending');
    expect(EscrowStatus.RELEASED).toBe('released');
    expect(EscrowStatus.PENALIZED).toBe('penalized');
    expect(EscrowStatus.CANCELLED).toBe('cancelled');
    expect(BountyStatus.ACTIVE).toBe('active');
    expect(BountyStatus.ACCEPTED).toBe('accepted');
    expect(BountyStatus.COMPLETED).toBe('completed');
    expect(BountyStatus.CANCELLED).toBe('cancelled');
    expect(BountyStatus.FAILED).toBe('failed');
    expect(CreditStatus.ACTIVE).toBe('active');
    expect(CreditStatus.SETTLED).toBe('settled');
    expect(CreditStatus.DEFAULTED).toBe('defaulted');
    expect(CreditStatus.OVERDUE).toBe('overdue');
    expect(BarterStatus.PENDING).toBe('pending');
    expect(BarterStatus.COMPLETED).toBe('completed');
    expect(BarterStatus.CANCELLED).toBe('cancelled');
  });

  it('should expose social economy error codes', () => {
    expect(ErrorCodes.NEGOTIATION_NOT_FOUND).toBe(91501);
    expect(ErrorCodes.NEGOTIATION_STEP_LIMIT).toBe(91502);
    expect(ErrorCodes.ESCROW_NOT_FOUND).toBe(91503);
    expect(ErrorCodes.ESCROW_NOT_READY).toBe(91504);
    expect(ErrorCodes.GUARANTOR_NOT_QUALIFIED).toBe(91505);
    expect(ErrorCodes.BOUNTY_NOT_FOUND).toBe(91506);
    expect(ErrorCodes.BOUNTY_FULL).toBe(91507);
    expect(ErrorCodes.BOUNTY_DEADLINE).toBe(91508);
    expect(ErrorCodes.CREDIT_NOT_FOUND).toBe(91509);
    expect(ErrorCodes.CREDIT_OVERDUE).toBe(91510);
    expect(ErrorCodes.BARTER_NOT_FOUND).toBe(91511);
    expect(ErrorCodes.BARTER_CONFIRM_MISMATCH).toBe(91512);
  });

  it('should expose new entity classes', () => {
    const entities = [
      Negotiation,
      EscrowAgreement,
      Bounty,
      CreditDebt,
      BarterDeal,
    ];
    for (const entity of entities) {
      expect(typeof entity).toBe('function');
    }
  });

  it('should expose negotiation entity columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === Negotiation,
    );
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === Negotiation,
    );
    expect((table as any).name).toBe('negotiations');
    expect(columns.find((c) => c.propertyName === 'buyerId')).toBeDefined();
    expect(columns.find((c) => c.propertyName === 'sellerId')).toBeDefined();
    expect(columns.find((c) => c.propertyName === 'tradeOrderId')).toBeDefined();
    const askPrice = columns.find((c) => c.propertyName === 'askPrice');
    expect((askPrice.options as any).name).toBe('ask_price');
    expect((askPrice.options as any).type).toBe('bigint');
    const replyPrice = columns.find((c) => c.propertyName === 'replyPrice');
    expect((replyPrice.options as any).name).toBe('reply_price');
    const step = columns.find((c) => c.propertyName === 'step');
    expect((step.options as any).default).toBe(1);
    const maxSteps = columns.find((c) => c.propertyName === 'maxSteps');
    expect((maxSteps.options as any).name).toBe('max_steps');
    expect((maxSteps.options as any).default).toBe(3);
    const status = columns.find((c) => c.propertyName === 'status');
    expect((status.options as any).enum).toBe(NegotiationStatus);
    const discount = columns.find((c) => c.propertyName === 'discountPercent');
    expect((discount.options as any).name).toBe('discount_percent');
    expect((discount.options as any).default).toBe(0);
    const message = columns.find((c) => c.propertyName === 'message');
    expect((message.options as any).length).toBe(128);
  });

  it('should expose escrow agreement entity columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === EscrowAgreement,
    );
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === EscrowAgreement,
    );
    expect((table as any).name).toBe('escrow_agreements');
    expect(columns.find((c) => c.propertyName === 'buyerId')).toBeDefined();
    expect(columns.find((c) => c.propertyName === 'sellerId')).toBeDefined();
    expect(columns.find((c) => c.propertyName === 'guarantorId')).toBeDefined();
    const feePercent = columns.find((c) => c.propertyName === 'feePercent');
    expect((feePercent.options as any).name).toBe('fee_percent');
    expect((feePercent.options as any).default).toBe(2);
    const status = columns.find((c) => c.propertyName === 'status');
    expect((status.options as any).enum).toBe(EscrowStatus);
    const releasedAt = columns.find((c) => c.propertyName === 'releasedAt');
    expect((releasedAt.options as any).name).toBe('released_at');
    expect((releasedAt.options as any).nullable).toBe(true);
  });

  it('should expose bounty entity columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === Bounty,
    );
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === Bounty,
    );
    expect((table as any).name).toBe('bounties');
    expect(columns.find((c) => c.propertyName === 'publisherId')).toBeDefined();
    const type = columns.find((c) => c.propertyName === 'type');
    expect((type.options as any).length).toBe(32);
    const targetJson = columns.find((c) => c.propertyName === 'targetJson');
    expect((targetJson.options as any).name).toBe('target_json');
    expect((targetJson.options as any).type).toBe('jsonb');
    const goldReward = columns.find((c) => c.propertyName === 'goldReward');
    expect((goldReward.options as any).name).toBe('gold_reward');
    expect((goldReward.options as any).type).toBe('bigint');
    const deadline = columns.find((c) => c.propertyName === 'deadline');
    expect((deadline.options as any).nullable).toBe(true);
    const maxAcceptors = columns.find((c) => c.propertyName === 'maxAcceptors');
    expect((maxAcceptors.options as any).name).toBe('max_acceptors');
    expect((maxAcceptors.options as any).default).toBe(1);
    const acceptorId = columns.find((c) => c.propertyName === 'acceptorId');
    expect((acceptorId.options as any).name).toBe('acceptor_id');
    expect((acceptorId.options as any).nullable).toBe(true);
    const status = columns.find((c) => c.propertyName === 'status');
    expect((status.options as any).enum).toBe(BountyStatus);
  });

  it('should expose credit debt entity columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === CreditDebt,
    );
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === CreditDebt,
    );
    expect((table as any).name).toBe('credit_debts');
    expect(columns.find((c) => c.propertyName === 'borrowerId')).toBeDefined();
    expect(columns.find((c) => c.propertyName === 'lenderId')).toBeDefined();
    const dueAt = columns.find((c) => c.propertyName === 'dueAt');
    expect((dueAt.options as any).name).toBe('due_at');
    const collateral = columns.find((c) => c.propertyName === 'collateralAmount');
    expect((collateral.options as any).name).toBe('collateral_amount');
    const status = columns.find((c) => c.propertyName === 'status');
    expect((status.options as any).enum).toBe(CreditStatus);
    const settledAt = columns.find((c) => c.propertyName === 'settledAt');
    expect((settledAt.options as any).name).toBe('settled_at');
    expect((settledAt.options as any).nullable).toBe(true);
  });

  it('should expose barter deal entity columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === BarterDeal,
    );
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === BarterDeal,
    );
    expect((table as any).name).toBe('barter_deals');
    const partyAId = columns.find((c) => c.propertyName === 'partyAId');
    expect((partyAId.options as any).name).toBe('party_a_id');
    const partyBId = columns.find((c) => c.propertyName === 'partyBId');
    expect((partyBId.options as any).name).toBe('party_b_id');
    expect((partyBId.options as any).nullable).toBe(true);
    const itemsA = columns.find((c) => c.propertyName === 'itemsAJson');
    expect((itemsA.options as any).name).toBe('items_a_json');
    expect((itemsA.options as any).type).toBe('jsonb');
    const itemsB = columns.find((c) => c.propertyName === 'itemsBJson');
    expect((itemsB.options as any).name).toBe('items_b_json');
    const goldAmount = columns.find((c) => c.propertyName === 'goldAmount');
    expect((goldAmount.options as any).name).toBe('gold_amount');
    expect((goldAmount.options as any).type).toBe('bigint');
    const aConfirm = columns.find((c) => c.propertyName === 'aConfirm');
    expect((aConfirm.options as any).name).toBe('a_confirm');
    expect((aConfirm.options as any).default).toBe(false);
    const bConfirm = columns.find((c) => c.propertyName === 'bConfirm');
    expect((bConfirm.options as any).name).toBe('b_confirm');
    const status = columns.find((c) => c.propertyName === 'status');
    expect((status.options as any).enum).toBe(BarterStatus);
  });
});
