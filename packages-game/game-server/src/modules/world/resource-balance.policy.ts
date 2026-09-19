/**
 * 资源点平衡策略（对应手册 5.21 场景资源能量平衡策略）
 * 纯逻辑无 IO，参数对齐 remote_configs 的 resource.* 键，便于单测与热更。
 */
export interface ResourceBalanceConfig {
  /** 全服日产量硬上限（稀有资源，默认不限） */
  dailyCap?: number;
  /** 第 N 次采集后开始效率递减（默认 30） */
  effDecayAfter?: number;
  /** 递减速率 0~1（默认 0.3） */
  effDecayRate?: number;
  /** 退化阈值：连续采集超过该次数触发退化（默认 50） */
  degradeThreshold?: number;
  /** 退化惩罚 0~1：退化期产量乘数扣减（默认 0.5） */
  degradeMalus?: number;
  /** 休渔/休矿恢复加成 0~1（默认 0.25） */
  restoreBonus?: number;
  /** 供需健康比值上限（默认 1.2 = 20% 富余） */
  dailySupplyRatio?: number;
}

export const DEFAULT_RESOURCE_BALANCE: ResourceBalanceConfig = {
  dailyCap: Infinity,
  effDecayAfter: 30,
  effDecayRate: 0.3,
  degradeThreshold: 50,
  degradeMalus: 0.5,
  restoreBonus: 0.25,
  dailySupplyRatio: 1.2,
};

/** 效率系数下限：递减不归零，保证低活跃玩家仍可采集 */
export const MIN_EFFICIENCY = 0.3;

export class ResourceBalancePolicy {
  constructor(
    private readonly cfg: ResourceBalanceConfig = DEFAULT_RESOURCE_BALANCE,
  ) {}

  /** 单次采集效率系数（0~1）：超过 effDecayAfter 次后按 effDecayRate 递减，下限 MIN_EFFICIENCY */
  efficiencyFactor(harvestCount: number): number {
    if (harvestCount <= (this.cfg.effDecayAfter ?? 0)) return 1;
    const f =
      1 -
      (harvestCount - (this.cfg.effDecayAfter ?? 0)) *
        (this.cfg.effDecayRate ?? 0);
    return Math.max(f, MIN_EFFICIENCY);
  }

  /** 是否触发退化（过度采伐 → 林地退化） */
  isDegraded(consecutiveHarvests: number): boolean {
    return consecutiveHarvests > (this.cfg.degradeThreshold ?? Infinity);
  }

  /** 退化期产量（乘数扣减 degradeMalus） */
  degradedYield(
    baseYield: number,
    consecutiveHarvests: number,
  ): number {
    return this.isDegraded(consecutiveHarvests)
      ? baseYield * (1 - (this.cfg.degradeMalus ?? 0))
      : baseYield;
  }

  /** 休渔/休矿期产量（+restoreBonus） */
  restoredYield(baseYield: number, resting: boolean): number {
    return resting
      ? baseYield * (1 + (this.cfg.restoreBonus ?? 0))
      : baseYield;
  }

  /** 当日累计产量是否已达全服硬上限（稀有资源限量） */
  dailyCapExceeded(producedToday: number): boolean {
    return producedToday >= (this.cfg.dailyCap ?? Infinity);
  }

  /** 供需健康判定：<1 缺货 / 1~dailySupplyRatio 健康 / 超上限 富余 */
  supplyHealth(
    dailyProduce: number,
    dailyConsume: number,
  ): 'shortage' | 'healthy' | 'surplus' {
    const ratio =
      dailyConsume > 0
        ? dailyProduce / dailyConsume
        : dailyProduce > 0
          ? Infinity
          : 1;
    if (ratio < 1) return 'shortage';
    if (ratio > (this.cfg.dailySupplyRatio ?? 1.2)) return 'surplus';
    return 'healthy';
  }

  /** 单点采集冷却校验（interact_cd 秒数，矿脉 12h=43200） */
  isValidInteractCd(seconds: number): boolean {
    return Number.isFinite(seconds) && seconds >= 0;
  }
}
