import { Tile, Meld } from './types';
import { tileId, tileFromId, toCounts } from './tiles';

/**
 * 判断 counts（27 长度计数数组）能否拆成 sets 个面子（刻子或顺子）。
 * 同花色顺子约束：rank(0-8) 内 i,i+1,i+2 必同花色（每花色 9 张）。
 */
function canFormMelds(counts: number[], sets: number): boolean {
  if (sets === 0) return counts.every((c) => c === 0);
  const i = counts.findIndex((c) => c > 0);
  if (i === -1) return false;
  // 刻子
  if (counts[i] >= 3) {
    counts[i] -= 3;
    const ok = canFormMelds(counts, sets - 1);
    counts[i] += 3;
    if (ok) return true;
  }
  // 顺子（本花色内 rank 0-6 才能起顺）
  const rank = i % 9;
  if (rank <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    const ok = canFormMelds(counts, sets - 1);
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** 标准型（4 面子 + 1 将）判定 */
export function isStandardHu(concealed: Tile[], melds: Meld[]): boolean {
  const neededSets = 4 - melds.length;
  if (neededSets < 0) return false;
  const counts = toCounts(concealed);
  for (let i = 0; i < 27; i++) {
    if (counts[i] >= 2) {
      counts[i] -= 2;
      const ok = canFormMelds(counts, neededSets);
      counts[i] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/** 七对 / 龙七对 判定（仅在无碰杠时有效） */
export function checkQidui(concealed: Tile[]): 'qidui' | 'longqidui' | null {
  if (concealed.length !== 14) return null;
  const counts = toCounts(concealed);
  let pairs = 0;
  let hasFour = false;
  for (const c of counts) {
    if (c === 0) continue;
    if (c === 2) pairs++;
    else if (c === 4) {
      pairs += 2; // 四张同牌计为两对
      hasFour = true;
    } else return null; // 1 或 3 不能构成七对
  }
  if (pairs !== 7) return null;
  return hasFour ? 'longqidui' : 'qidui';
}

/** 综合胡牌判定（不校验缺一门，由调用方负责） */
export function isHu(
  concealed: Tile[],
  melds: Meld[],
): { standard: boolean; qidui: 'qidui' | 'longqidui' | null } {
  return {
    standard: isStandardHu(concealed, melds),
    qidui: melds.length === 0 ? checkQidui(concealed) : null,
  };
}

/** 是否缺一门合规：手牌+碰杠均不含该花色 */
export function satisfiesQueMen(tiles: Tile[], queuedSuit: Tile['suit'] | null): boolean {
  if (!queuedSuit) return true;
  return !tiles.some((t) => t.suit === queuedSuit);
}

/**
 * 听牌枚举：在不含缺门的前提下，尝试把 27 种牌逐一加入手牌，
 * 若可胡则返回等待牌集合。concealed 应为 13 张（听牌态）。
 */
export function getTing(concealed: Tile[], melds: Meld[], queuedSuit: Tile['suit'] | null): Tile[] {
  const result: Tile[] = [];
  if (concealed.length % 3 !== 1) return result; // 听牌态手牌数 ≡ 1 mod 3
  for (let id = 0; id < 27; id++) {
    const t = tileFromId(id);
    if (t.suit === queuedSuit) continue;
    const test = [...concealed, t];
    const r = isHu(test, melds);
    if (r.standard || r.qidui) result.push(t);
  }
  return result;
}
