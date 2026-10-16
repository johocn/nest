import { Tile, Meld, FanResult, FanItem } from './types';
import { toCounts, SUITS } from './tiles';
import { isStandardHu, checkQidui } from './hu';

export interface FanContext {
  selfDraw: boolean; // 自摸
  robbed?: boolean; // 抢杠胡
  gangFlowers?: boolean; // 杠上开花
  lastTile?: boolean; // 海底捞月
  isDealer?: boolean; // 庄家
  firstAction?: boolean; // 首巡（用于天胡/地胡）
}

/** 仅用刻子能否拆出 sets 组（碰碰胡判定） */
function tripletsOnly(counts: number[], sets: number): boolean {
  if (sets === 0) return counts.every((c) => c === 0);
  const i = counts.findIndex((c) => c > 0);
  if (i === -1) return false;
  if (counts[i] >= 3) {
    counts[i] -= 3;
    const ok = tripletsOnly(counts, sets - 1);
    counts[i] += 3;
    if (ok) return true;
  }
  return false;
}

export function isPengPeng(concealed: Tile[], melds: Meld[]): boolean {
  const neededSets = 4 - melds.length;
  const counts = toCounts(concealed);
  for (let i = 0; i < 27; i++) {
    if (counts[i] >= 2) {
      counts[i] -= 2;
      const ok = tripletsOnly(counts, neededSets);
      counts[i] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/** 全带幺：每副牌（含将）都含 1 或 9 */
function canFormTerminal(counts: number[], sets: number): boolean {
  if (sets === 0) return counts.every((c) => c === 0);
  const i = counts.findIndex((c) => c > 0);
  if (i === -1) return false;
  const rank = i % 9;
  if (counts[i] >= 3 && (rank === 0 || rank === 8)) {
    counts[i] -= 3;
    const ok = canFormTerminal(counts, sets - 1);
    counts[i] += 3;
    if (ok) return true;
  }
  if ((rank === 0 || rank === 6) && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    const ok = canFormTerminal(counts, sets - 1);
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
    if (ok) return true;
  }
  return false;
}

export function isQuanDaiYao(concealed: Tile[], melds: Meld[]): boolean {
  const neededSets = 4 - melds.length;
  const counts = toCounts(concealed);
  for (let i = 0; i < 27; i++) {
    const rank = i % 9;
    if (counts[i] >= 2 && (rank === 0 || rank === 8)) {
      counts[i] -= 2;
      const ok = canFormTerminal(counts, neededSets);
      counts[i] += 2;
      if (ok) return true;
    }
  }
  return false;
}

function allTiles(concealed: Tile[], melds: Meld[]): Tile[] {
  const out: Tile[] = [...concealed];
  for (const m of melds) {
    const n = m.type === 'peng' ? 3 : 4;
    for (let i = 0; i < n; i++) out.push(m.tile);
  }
  return out;
}

function isQingYiSe(concealed: Tile[], melds: Meld[]): boolean {
  const all = allTiles(concealed, melds);
  const suits = new Set(all.map((t) => t.suit));
  return suits.size === 1;
}

/** 计算「根」数量：4 张相同为一根 */
function countRoots(concealed: Tile[], melds: Meld[]): number {
  let roots = 0;
  const counts = toCounts(concealed);
  for (const c of counts) if (c === 4) roots++;
  for (const m of melds) {
    if (m.type === 'gang' || m.type === 'angang' || m.type === 'bugang') roots++;
  }
  return roots;
}

/** 主算分函数 */
export function scoreHand(
  concealed: Tile[],
  melds: Meld[],
  ctx: FanContext,
): FanResult {
  const fans: FanItem[] = [];
  const add = (name: string, count = 1) => {
    const f = fans.find((x) => x.name === name);
    if (f) f.count += count;
    else fans.push({ name, count });
  };

  const qidui = melds.length === 0 ? checkQidui(concealed) : null;
  const standard = isStandardHu(concealed, melds);

  if (qidui === 'longqidui') add('龙七对', 2);
  else if (qidui === 'qidui') add('七对', 1);
  else if (!standard) {
    // 既不符合标准也不符合七对，理论上不应到达（调用前应已校验）
    add('平胡', 1);
  }

  const pengPeng = isPengPeng(concealed, melds);
  const quanDaiYao = isQuanDaiYao(concealed, melds);
  const qingYiSe = isQingYiSe(concealed, melds);

  if (pengPeng) add('碰碰胡', 1);
  if (quanDaiYao) add('全带幺', 1);
  if (qingYiSe) add('清一色', 2);
  if (pengPeng && quanDaiYao) add('清幺九', 2); // 全为 1/9 的碰碰胡
  if (melds.length === 4) add('金钩钓', 1); // 四组均为碰杠，仅剩将

  const roots = countRoots(concealed, melds);
  if (roots > 0) add('根', roots);

  if (ctx.selfDraw) add('自摸', 1);
  if (ctx.gangFlowers) add('杠上开花', 1);
  if (ctx.robbed) add('抢杠胡', 1);
  if (ctx.lastTile) add('海底捞月', 1);
  if (ctx.isDealer && ctx.firstAction && ctx.selfDraw) add('天胡', 3);
  if (!ctx.isDealer && ctx.firstAction && !ctx.selfDraw) add('地胡', 3);

  if (fans.length === 0) add('平胡', 1);

  const totalFan = fans.reduce((s, f) => s + f.count, 0);
  const multiplier = Math.pow(2, Math.min(totalFan, 8));
  const base = 1;
  const score = base * multiplier;

  const detail =
    `番型：${fans.map((f) => `${f.name}${f.count > 1 ? '×' + f.count : ''}`).join('、')}；` +
    `总番 ${totalFan}，倍数 ×${multiplier}，底分 ${base}，得分 ${score}`;

  return { fans, totalFan, base, multiplier, score, detail };
}
