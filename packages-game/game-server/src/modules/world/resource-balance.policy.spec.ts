import {
  ResourceBalancePolicy,
  DEFAULT_RESOURCE_BALANCE,
  MIN_EFFICIENCY,
} from './resource-balance.policy';

describe('ResourceBalancePolicy 资源点平衡策略（5.21）', () => {
  const policy = new ResourceBalancePolicy();

  describe('效率递减（⑥ 防挂机护栏）', () => {
    it('前 N 次采集效率为 1（不递减）', () => {
      expect(policy.efficiencyFactor(1)).toBe(1);
      expect(policy.efficiencyFactor(30)).toBe(1);
    });

    it('超过 N 次后按速率递减', () => {
      // 第 31 次：1 - (31-30)*0.3 = 0.7
      expect(policy.efficiencyFactor(31)).toBeCloseTo(0.7);
      // 第 34 次：1 - (34-30)*0.3 = -0.2 → 被钳制到下限 0.3
      expect(policy.efficiencyFactor(34)).toBe(MIN_EFFICIENCY);
    });

    it('递减有下限，不归零（低活跃玩家仍可采集）', () => {
      expect(policy.efficiencyFactor(1000)).toBe(MIN_EFFICIENCY);
    });

    it('自定义配置可调阈值与速率', () => {
      const p = new ResourceBalancePolicy({
        effDecayAfter: 10,
        effDecayRate: 0.1,
      });
      expect(p.efficiencyFactor(10)).toBe(1);
      expect(p.efficiencyFactor(11)).toBeCloseTo(0.9);
    });
  });

  describe('生态动态（③ 枯竭与丰饶）', () => {
    it('连续采集超过阈值触发退化', () => {
      expect(policy.isDegraded(50)).toBe(false);
      expect(policy.isDegraded(51)).toBe(true);
    });

    it('退化期产量按 50% 扣减（林地退化 -50%）', () => {
      expect(policy.degradedYield(100, 51)).toBe(50);
      expect(policy.degradedYield(100, 50)).toBe(100);
    });

    it('休渔/休矿期产量 +25%（丰饶恢复）', () => {
      expect(policy.restoredYield(100, true)).toBe(125);
      expect(policy.restoredYield(100, false)).toBe(100);
    });
  });

  describe('全服日产量硬上限（⑤ 稀缺限量）', () => {
    it('达到上限后判定超限（稀有矿停采）', () => {
      const p = new ResourceBalancePolicy({ dailyCap: 500 });
      expect(p.dailyCapExceeded(499)).toBe(false);
      expect(p.dailyCapExceeded(500)).toBe(true);
      expect(p.dailyCapExceeded(501)).toBe(true);
    });

    it('默认不限产量', () => {
      expect(policy.dailyCapExceeded(1e9)).toBe(false);
    });
  });

  describe('供需平衡（② 产能与消耗）', () => {
    it('产量低于消耗为缺货（资源焦虑）', () => {
      expect(policy.supplyHealth(80, 100)).toBe('shortage');
    });

    it('产量在 1~1.2 倍消耗为健康带', () => {
      expect(policy.supplyHealth(100, 100)).toBe('healthy');
      expect(policy.supplyHealth(120, 100)).toBe('healthy');
    });

    it('产量超 1.2 倍消耗为富余（物价崩盘预警）', () => {
      expect(policy.supplyHealth(121, 100)).toBe('surplus');
    });

    it('消耗为 0 时按产量判定（无锚点资源贬值）', () => {
      expect(policy.supplyHealth(0, 0)).toBe('healthy');
      expect(policy.supplyHealth(10, 0)).toBe('surplus');
    });
  });

  describe('供给节奏校验（① interact_cd）', () => {
    it('矿脉 12h=43200s 有效', () => {
      expect(policy.isValidInteractCd(43200)).toBe(true);
    });

    it('负值/非数字冷却无效', () => {
      expect(policy.isValidInteractCd(-1)).toBe(false);
      expect(policy.isValidInteractCd(NaN)).toBe(false);
    });
  });

  describe('默认配置', () => {
    it('默认参数与手册一致', () => {
      expect(DEFAULT_RESOURCE_BALANCE).toMatchObject({
        effDecayAfter: 30,
        effDecayRate: 0.3,
        degradeThreshold: 50,
        degradeMalus: 0.5,
        restoreBonus: 0.25,
        dailySupplyRatio: 1.2,
      });
      expect(DEFAULT_RESOURCE_BALANCE.dailyCap).toBe(Infinity);
    });
  });
});
