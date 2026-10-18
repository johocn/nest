// 三国杀 AI：出牌阶段决策 + 响应决策（补位 / 掉线接管）

import { SgsCard, SgsClientAction, SgsGameState } from './types';
import { canAttack, shaLimited } from './engine';
import { heroHasSkill } from './skills';
import { isRed } from './cards';

function hasCard(
  state: SgsGameState,
  seat: number,
  defId: string,
): string | undefined {
  return state.players[seat].hand.find(
    (id) => state.cards[id]?.defId === defId,
  );
}

function findRedAsSha(state: SgsGameState, seat: number): string | undefined {
  if (!heroHasSkill(state.players[seat].heroId, 'wusheng')) return undefined;
  return state.players[seat].hand.find(
    (id) =>
      state.cards[id] &&
      isRed(state.cards[id].suit) &&
      state.cards[id].type !== 'equipment',
  );
}

function findLongdanShan(
  state: SgsGameState,
  seat: number,
): string | undefined {
  if (!heroHasSkill(state.players[seat].heroId, 'longdan')) return undefined;
  return state.players[seat].hand.find(
    (id) => state.cards[id]?.defId === 'shan',
  );
}

/** 统计可当作【杀】响应的牌数（杀 + 赵云·龙胆的闪） */
function countSha(state: SgsGameState, seat: number): number {
  const h = state.players[seat].hand;
  let c = 0;
  for (const id of h) {
    const card = state.cards[id];
    if (!card) continue;
    if (card.defId === 'sha') c++;
    else if (
      heroHasSkill(state.players[seat].heroId, 'longdan') &&
      card.defId === 'shan'
    )
      c++;
  }
  return c;
}

/** 统计可当【闪】响应的牌数（闪 + 赵云·龙胆的杀 + 甄姬·倾国的黑牌） */
function countShan(state: SgsGameState, seat: number): number {
  const h = state.players[seat].hand;
  let c = 0;
  for (const id of h) {
    const card = state.cards[id];
    if (!card) continue;
    if (card.defId === 'shan') c++;
    else if (
      heroHasSkill(state.players[seat].heroId, 'longdan') &&
      card.defId === 'sha'
    )
      c++;
    else if (
      heroHasSkill(state.players[seat].heroId, 'qingguo') &&
      card.type !== 'equipment' &&
      (card.suit === 'spade' || card.suit === 'club')
    )
      c++;
  }
  return c;
}

/** 出牌阶段：返回一个动作（含 end_turn） */
export function chooseAction(
  state: SgsGameState,
  seat: number,
): SgsClientAction {
  const p = state.players[seat];
  if (!p.isAlive || state.turn !== seat || state.phase !== 'play') {
    return { type: 'pass' };
  }

  // 1) 残血且手持桃 → 自救
  if (p.hp < p.maxHp) {
    const tao = hasCard(state, seat, 'tao');
    if (tao) return { type: 'play', cardIds: [tao] };
  }

  // 1.5) 决斗破闪：持【决斗】时优先对「杀打不动」的对手（带八卦阵 / 闪充足）发动决斗。
  //      决斗以【杀】响应、无视【闪】/【八卦阵】，且必造成一方掉血——是打破互闪僵局的关键。
  //      若自己杀数占优也照常决斗；否则仅对防守型对手发动（反正杀无效，决斗必推进战局）。
  const juedou = hasCard(state, seat, 'jie_dou');
  if (juedou) {
    let best: number | null = null;
    let bestSha = Infinity;
    let bestDefensive = false;
    for (let i = 1; i < state.seats; i++) {
      const s = (seat + i) % state.seats;
      const t = state.players[s];
      if (!t.isAlive) continue;
      // 空城（诸葛亮·空城且空手牌）不可作为决斗目标
      if (heroHasSkill(t.heroId, 'kongcheng') && t.hand.length === 0) continue;
      const ts = countSha(state, s);
      const sh = countShan(state, s);
      const bagua = !!t.armor && state.cards[t.armor]?.defId === 'ba_gua';
      const defensive = bagua || sh >= 2;
      // 评分：防守型(杀打不动)优先；同档内选杀数最少者
      const score = (defensive ? 0 : 10) + ts;
      if (score < (bestDefensive ? 0 : 10) + bestSha) {
        bestSha = ts;
        bestDefensive = defensive;
        best = s;
      }
    }
    if (best != null && (bestDefensive || countSha(state, seat) > bestSha)) {
      return { type: 'play', cardIds: [juedou], target: best };
    }
  }

  // 2) 兵粮寸断：压制「依赖闪/带八卦」的对手，限制其摸牌补闪的续航能力。
  const bingliang = hasCard(state, seat, 'bing_liang');
  if (bingliang) {
    let tgt: number | null = null;
    let tgtShan = 0;
    for (let i = 1; i < state.seats; i++) {
      const s = (seat + i) % state.seats;
      const t = state.players[s];
      if (!t.isAlive) continue;
      const sh = countShan(state, s);
      if (sh > tgtShan) {
        tgtShan = sh;
        tgt = s;
      }
    }
    if (tgt != null && tgtShan >= 1) {
      return { type: 'play', cardIds: [bingliang], target: tgt };
    }
  }

  // 是否存在「闪充足」的存活对手（闪等价牌≥2）——若有则优先用 AoE 消耗其闪库存
  let shanHeavy = false;
  for (let i = 1; i < state.seats; i++) {
    const s = (seat + i) % state.seats;
    if (state.players[s].isAlive && countShan(state, s) >= 2) {
      shanHeavy = true;
      break;
    }
  }
  const aoe =
    hasCard(state, seat, 'nan_man') ?? hasCard(state, seat, 'wan_jian');

  // 3) 若对手闪充足，先放 AoE 逼其弃闪，便于后续出杀命中
  if (aoe && shanHeavy) return { type: 'play', cardIds: [aoe] };

  // 4) 诸葛连弩/咆哮 或 还有出杀额度 → 优先出杀打最近目标（关羽·武圣红牌、赵云·龙胆闪可当杀）
  if (!shaLimited(state, seat) || p.shaCount < state.rules.baseShaLimit) {
    const sha =
      hasCard(state, seat, 'sha') ??
      findRedAsSha(state, seat) ??
      findLongdanShan(state, seat);
    if (sha) {
      const target = nextAttackable(state, seat);
      if (target != null) return { type: 'play', cardIds: [sha], target };
    }
  }

  // 5) 锦囊：无中生有（摸牌）优先
  const wuzhong = hasCard(state, seat, 'wu_zhong');
  if (wuzhong) return { type: 'play', cardIds: [wuzhong] };

  // 6) AoE：南蛮/万箭（清场，逼闪）
  if (aoe) return { type: 'play', cardIds: [aoe] };

  // 5) 装备：上武器/马
  const equip = p.hand.find((id) => state.cards[id]?.type === 'equipment');
  if (equip) return { type: 'play', cardIds: [equip] };

  return { type: 'end_turn' };
}

function nextAttackable(state: SgsGameState, seat: number): number | null {
  for (let i = 1; i <= state.seats; i++) {
    const s = (seat + i) % state.seats;
    if (state.players[s].isAlive && canAttack(state, seat, s)) return s;
  }
  return null;
}

/** 响应阶段：是否出闪 / 是否无懈 */
export function chooseRespond(
  state: SgsGameState,
  seat: number,
): SgsClientAction {
  const ask = state.pendingAsk;
  if (!ask || ask.target !== seat) return { type: 'pass' };
  if (ask.kind === 'dodge') {
    const hand = state.players[seat].hand;
    const need = ask.wushuang ? 2 : 1;
    let count = 0;
    for (const id of hand) {
      const c = state.cards[id];
      if (!c) continue;
      if (c.defId === 'shan') count++;
      else if (
        heroHasSkill(state.players[seat].heroId, 'longdan') &&
        c.defId === 'sha'
      )
        count++;
      else if (
        heroHasSkill(state.players[seat].heroId, 'qingguo') &&
        c.type !== 'equipment' &&
        (c.suit === 'spade' || c.suit === 'club')
      )
        count++;
      if (count >= need) break;
    }
    return { type: 'respond', dodge: count >= need };
  }
  if (ask.kind === 'wuxie') {
    const hasWuxie = state.players[seat].hand.some(
      (id) => state.cards[id]?.defId === 'wu_xie',
    );
    if (!hasWuxie) return { type: 'respond', wuxie: false };
    const t = ask.pendingTrick;
    // 决斗特判：若自己是决斗目标且杀数不占优（必输），不必浪费无懈取消——
    // 让决斗结算、自己掉血，才能打破「双方互闪/八卦」的僵局；只有自己能赢时才取消。
    if (t?.type === 'duel' && t.target === seat && ask.source != null) {
      const mySha = countSha(state, seat);
      const srcSha = countSha(state, ask.source);
      return { type: 'respond', wuxie: mySha > srcSha && !ask.negated };
    }
    // 锦囊对自己有害、且尚未被抵消时才打无懈（否则会反抵消、帮倒忙）
    let harmful = false;
    if (t?.type === 'aoe')
      harmful = true; // 全局抵消（简化）：可保护自身
    else if (t?.target === seat) harmful = true;
    return { type: 'respond', wuxie: harmful && !ask.negated };
  }
  return { type: 'pass' };
}

export function botCardName(card: SgsCard): string {
  return card?.name ?? '';
}
