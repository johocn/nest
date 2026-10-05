import { AchievementCondition } from '@constants/enums';
import {
  isJsonObject,
  JSON_KEY_TO_ENUM,
  inferConditionFromJson,
  toEntityPayload,
  fromEntity,
} from './achievement-admin.controller';

describe('AchievementAdmin mapping layer', () => {
  // ========== JSON_KEY_TO_ENUM 完整性 ==========
  describe('JSON_KEY_TO_ENUM', () => {
    it('covers all 7 AchievementCondition enum values', () => {
      const covered = new Set(Object.values(JSON_KEY_TO_ENUM));
      expect(covered.has(AchievementCondition.KILL_COUNT)).toBe(true);
      expect(covered.has(AchievementCondition.REACH_LEVEL)).toBe(true);
      expect(covered.has(AchievementCondition.COMPLETE_QUEST)).toBe(true);
      expect(covered.has(AchievementCondition.EARN_CURRENCY)).toBe(true);
      expect(covered.has(AchievementCondition.JOIN_GUILD)).toBe(true);
      expect(covered.has(AchievementCondition.ADD_FRIEND)).toBe(true);
      expect(covered.has(AchievementCondition.WIN_COMBAT)).toBe(true);
    });
  });

  // ========== inferConditionFromJson ==========
  describe('inferConditionFromJson', () => {
    it('infers KILL_COUNT from kills key', () => {
      expect(inferConditionFromJson({ kills: 100 })).toBe(AchievementCondition.KILL_COUNT);
    });
    it('infers KILL_COUNT from killCount key', () => {
      expect(inferConditionFromJson({ killCount: 50 })).toBe(AchievementCondition.KILL_COUNT);
    });
    it('infers REACH_LEVEL from target key', () => {
      expect(inferConditionFromJson({ target: 60 })).toBe(AchievementCondition.REACH_LEVEL);
    });
    it('infers REACH_LEVEL from level key', () => {
      expect(inferConditionFromJson({ level: 60 })).toBe(AchievementCondition.REACH_LEVEL);
    });
    it('infers COMPLETE_QUEST from questCount', () => {
      expect(inferConditionFromJson({ questCount: 3 })).toBe(AchievementCondition.COMPLETE_QUEST);
    });
    it('infers COMPLETE_QUEST from questId', () => {
      expect(inferConditionFromJson({ questId: 'q1' })).toBe(AchievementCondition.COMPLETE_QUEST);
    });
    it('infers EARN_CURRENCY from totalGold', () => {
      expect(inferConditionFromJson({ totalGold: 10000 })).toBe(AchievementCondition.EARN_CURRENCY);
    });
    it('infers JOIN_GUILD from guildId', () => {
      expect(inferConditionFromJson({ guildId: 'g1' })).toBe(AchievementCondition.JOIN_GUILD);
    });
    it('infers ADD_FRIEND from friendCount', () => {
      expect(inferConditionFromJson({ friendCount: 5 })).toBe(AchievementCondition.ADD_FRIEND);
    });
    it('infers WIN_COMBAT from wins', () => {
      expect(inferConditionFromJson({ wins: 50 })).toBe(AchievementCondition.WIN_COMBAT);
    });
    it('returns null for unknown key', () => {
      expect(inferConditionFromJson({ exp: 1000 })).toBeNull();
    });
    it('returns null for empty object', () => {
      expect(inferConditionFromJson({})).toBeNull();
    });
    it('picks first known key when multiple present', () => {
      const result = inferConditionFromJson({ kills: 10, questCount: 3 });
      expect([AchievementCondition.KILL_COUNT, AchievementCondition.COMPLETE_QUEST]).toContain(result!);
    });
  });

  // ========== isJsonObject ==========
  describe('isJsonObject', () => {
    it('true for plain object', () => expect(isJsonObject({})).toBe(true));
    it('true for nested object', () => expect(isJsonObject({ a: { b: 1 } })).toBe(true));
    it('false for array', () => expect(isJsonObject([1, 2])).toBe(false));
    it('false for null', () => expect(isJsonObject(null)).toBe(false));
    it('false for string', () => expect(isJsonObject('{}')).toBe(false));
    it('false for number', () => expect(isJsonObject(123)).toBe(false));
  });

  // ========== toEntityPayload ==========
  describe('toEntityPayload', () => {
    it('maps target → targetValue', () => {
      const out = toEntityPayload({ target: 100 });
      expect(out.targetValue).toBe(100);
      expect(out.target).toBeUndefined();
    });

    it('maps scalar reward → rewardJson object', () => {
      const out = toEntityPayload({ reward: 'gold_coin' });
      expect(out.rewardJson).toEqual({ value: 'gold_coin' });
      expect(out.reward).toBeUndefined();
    });

    it('preserves object reward as-is', () => {
      const rewardObj = { items: [{ itemId: 'i1', count: 10 }] };
      const out = toEntityPayload({ reward: rewardObj });
      expect(out.rewardJson).toBe(rewardObj);
    });

    it('condition enum string → condition column', () => {
      const out = toEntityPayload({ condition: AchievementCondition.KILL_COUNT });
      expect(out.condition).toBe(AchievementCondition.KILL_COUNT);
      expect(out.conditionJson).toBeUndefined();
    });

    it('condition JSON object → conditionJson + inferred enum', () => {
      const out = toEntityPayload({ condition: { kills: 100 } });
      expect(out.conditionJson).toEqual({ kills: 100 });
      expect(out.condition).toBe(AchievementCondition.KILL_COUNT);
    });

    it('condition JSON object with unknown key → conditionJson + fallback REACH_LEVEL', () => {
      const out = toEntityPayload({ condition: { exp: 1000 } });
      expect(out.conditionJson).toEqual({ exp: 1000 });
      expect(out.condition).toBe(AchievementCondition.REACH_LEVEL); // fallback
    });

    it('no condition → fallback REACH_LEVEL', () => {
      const out = toEntityPayload({ name: 'test' });
      expect(out.condition).toBe(AchievementCondition.REACH_LEVEL);
    });
  });

  // ========== fromEntity ==========
  describe('fromEntity', () => {
    it('maps targetValue → target', () => {
      const out = fromEntity({ targetValue: 100 });
      expect(out.target).toBe(100);
    });

    it('maps rewardJson → reward', () => {
      const out = fromEntity({ rewardJson: { items: [] } });
      expect(out.reward).toEqual({ items: [] });
    });

    it('returns conditionJson when non-empty as condition', () => {
      const out = fromEntity({
        condition: AchievementCondition.KILL_COUNT,
        conditionJson: { kills: 100 },
      });
      expect(out.condition).toEqual({ kills: 100 });
    });

    it('falls back to condition enum when conditionJson empty', () => {
      const out = fromEntity({
        condition: AchievementCondition.REACH_LEVEL,
        conditionJson: {},
      });
      expect(out.condition).toBe(AchievementCondition.REACH_LEVEL);
    });

    it('returns null for null input', () => {
      expect(fromEntity(null)).toBeNull();
    });
  });
});
