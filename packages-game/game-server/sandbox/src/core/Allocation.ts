/** 资产配置占比：把各桶金额归一化为 0~1 的比例（和为 1，含 0/负数稳健） */
export function allocationFractions(values: number[]): number[] {
  // 负数与非法值先当成 0，再参与求和（避免负正抵消导致 total<=0 全归零）
  const clamped = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clamped.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  return clamped.map((v) => v / total);
}
