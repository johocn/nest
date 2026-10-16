// 三国杀标准身份局 · 核心状态机（纯函数：输入快照 → 新快照 + 事件）
//
// 设计说明（与 guandan 保持一致的「快照 + 事件」范式）：
//  - createGame / playCard / respond / endTurn 均对传入 state 先做深拷贝再原地修改，
//    返回新快照，便于单测与回放。
//  - 简化点（已在代码中标注）：AoE（南蛮/万箭）自动结算、无懈可击仅用于清除自身判定区、
//    八卦阵按「免费闪」处理、判定用随机模拟。规则 fidelity 可在后续迭代补齐。

import {
  Identity,
  SgsCardType,
  SgsEquipType,
  SgsPhase,
  SgsSuit,
} from '@constants/enums';
import {
  SgsCard,
  SgsClientAction,
  SgsGameState,
  SgsPlayerState,
  SgsRules,
  SgsPendingAsk,
  SgsPendingTrick,
  DEFAULT_RULES,
  CardDefId,
} from './types';

/** 回合上限兜底：防止极端僵局（如双方带八卦阵互相闪杀、残局无人可击杀）导致整局永不结束。
 * 正常对局极少超过 200 回合，此处设为宽松上限，仅作安全网，不影响正常对局。 */
const MAX_ROUNDS = 800;
import { buildDeck, shuffle, isRed } from './cards';
import {
  HEROES,
  SKILLS,
  heroHasSkill,
  getHero,
} from './skills';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function log(state: SgsGameState, ev: Omit<import('./types').SgsEvent, 't'>) {
  state.log.push({ t: state.log.length, ...ev });
}

/** 循环座位距离（8 人环） */
export function circularDist(a: number, b: number, seats: number): number {
  const d = Math.abs(a - b) % seats;
  return Math.min(d, seats - d);
}

/** 计算 attacker 对 target 的有效距离（含 +/-1 马） */
export function effectiveDistance(state: SgsGameState, attacker: number, target: number): number {
  const a = state.players[attacker];
  const t = state.players[target];
  let d = circularDist(attacker, target, state.seats);
  if (a.horseMinus) d -= 1;
  if (t.horsePlus) d += 1;
  return Math.max(1, d);
}

function weaponRange(state: SgsGameState, seat: number): number {
  const p = state.players[seat];
  if (p.weapon) {
    const w = state.cards[p.weapon];
    if (w?.attackRange) return w.attackRange;
  }
  return 1;
}

/** 是否能对 target 出杀（距离 + 空城判定） */
export function canAttack(state: SgsGameState, attacker: number, target: number): boolean {
  if (attacker === target) return false;
  const t = state.players[target];
  if (!t.isAlive) return false;
  if (heroHasSkill(t.heroId, 'kongcheng') && t.hand.length === 0) return false;
  const aHero = state.players[attacker].heroId;
  // 黄忠·烈弓：杀无视距离
  if (heroHasSkill(aHero, 'liegong')) return true;
  // 马超·马术：攻击距离 +1
  const extra = heroHasSkill(aHero, 'mashu') ? 1 : 0;
  return effectiveDistance(state, attacker, target) <= weaponRange(state, attacker) + extra;
}

/** 出杀是否有次数限制（咆哮 / 诸葛连弩） */
export function shaLimited(state: SgsGameState, seat: number): boolean {
  const p = state.players[seat];
  if (heroHasSkill(p.heroId, 'paoxiao')) return false;
  if (p.weapon && state.cards[p.weapon]?.defId === 'zhu_ge_crossbow') return false;
  return true;
}

/** 摸牌（含弃牌堆回收） */
export function drawCards(state: SgsGameState, seat: number, n: number): string[] {
  const p = state.players[seat];
  const drawn: string[] = [];
  for (let i = 0; i < n; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) break;
      // 回收弃牌堆时剔除任何脏数据（null/undefined），避免污染手牌
      state.drawPile = shuffle(state.discardPile.splice(0).filter(Boolean));
    }
    const id = state.drawPile.pop();
    if (!id) break;
    p.hand.push(id);
    drawn.push(id);
  }
  return drawn;
}

function reshuffleIfNeeded(state: SgsGameState) {
  if (state.drawPile.length === 0 && state.discardPile.length > 0) {
    state.drawPile = shuffle(state.discardPile.splice(0));
  }
}

function cardIdsInHand(state: SgsGameState, seat: number): string[] {
  return state.players[seat].hand;
}

function findCard(state: SgsGameState, seat: number, id: string): SgsCard | undefined {
  const p = state.players[seat];
  if (p.hand.includes(id)) return state.cards[id];
  for (const slot of [p.weapon, p.armor, p.horsePlus, p.horseMinus]) {
    if (slot === id) return state.cards[id];
  }
  return undefined;
}

function consumeFromHand(state: SgsGameState, seat: number, id: string): boolean {
  const p = state.players[seat];
  const idx = p.hand.indexOf(id);
  if (idx === -1) return false;
  p.hand.splice(idx, 1);
  state.discardPile.push(id);
  return true;
}

/** 创建一局（8 人标准身份局） */
export function createGame(
  isBot: boolean[],
  rules: Partial<SgsRules> = {},
  rng: () => number = Math.random,
): SgsGameState {
  const r: SgsRules = { ...DEFAULT_RULES, ...rules };
  const seats = r.seats;
  const { cards, pile } = buildDeck();
  shuffle(pile, rng);

  // 武将分配（池洗牌后取前 seats 个，不足则补足）
  const heroPool = shuffle([...HEROES], rng);
  const heroes: string[] = [];
  for (let i = 0; i < seats; i++) heroes.push(heroPool[i % heroPool.length].id);

  // 身份分配：0=主公，其余随机 2 忠臣 / 4 反贼 / 1 内奸（仅当 seats>=8）
  const identities: Identity[] = new Array(seats).fill(Identity.REBEL);
  identities[0] = Identity.LORD;
  if (seats >= 8) {
    // 仅从非主公座位（1..seats-1）中分配，避免覆盖主公
    const rest = shuffle([...Array(seats - 1).keys()].map((i) => i + 1), rng);
    identities[rest[0]] = Identity.LOYALIST;
    identities[rest[1]] = Identity.LOYALIST;
    identities[rest[2]] = Identity.SPY;
    // 其余为反贼（默认）
  } else {
    // 不足 8 人时退化为：1 主公 + 其余反贼（便于小桌测试）
    for (let i = 1; i < seats; i++) identities[i] = Identity.REBEL;
  }

  const players: SgsPlayerState[] = [];
  for (let i = 0; i < seats; i++) {
    const hero = getHero(heroes[i])!;
    const isLord = identities[i] === Identity.LORD;
    players.push({
      seat: i,
      heroId: hero.id,
      identity: identities[i],
      hp: isLord ? hero.hp + 1 : hero.hp,
      maxHp: isLord ? hero.hp + 1 : hero.hp,
      isAlive: true,
      isBot: !!isBot[i],
      hand: [],
      weapon: null,
      armor: null,
      horsePlus: null,
      horseMinus: null,
      judge: [],
      shaCount: 0,
    });
  }

  const state: SgsGameState = {
    seats,
    players,
    cards,
    drawPile: pile,
    discardPile: [],
    turn: 0,
    phase: SgsPhase.PREPARE,
    round: 1,
    lordSeat: 0,
    pendingAsk: null,
    winner: null,
    log: [],
    rules: r,
    drewThisTurn: false,
  };

  // 发初始手牌
  for (let i = 0; i < seats; i++) drawCards(state, i, r.initHand);
  log(state, { type: 'deal', text: `发牌完成，共 ${seats} 人` });
  log(state, { type: 'identity', seat: 0, text: '主公已就位' });

  // 初始发牌阶段不触发准备技能（洛神/突袭），保证发牌确定性；首轮真实回合仍由 start()/模拟循环调用 startTurn 触发
  startTurn(state, 0, false);
  return state;
}

/** 锦囊中文名（用于飘字 / 提示） */
const TRICK_NAMES: Record<string, string> = {
  jie_dou: '决斗',
  nan_man: '南蛮入侵',
  wan_jian: '万箭齐发',
  chai_qiao: '过河拆桥',
  shun_shou: '顺手牵羊',
  shan_dian: '闪电',
  le_bu: '乐不思蜀',
  bing_liang: '兵粮寸断',
  wu_xie: '无懈可击',
};
function trickName(d?: string): string {
  return d ? TRICK_NAMES[d] ?? '锦囊' : '锦囊';
}

/** 从牌堆顶翻一张判定牌（牌堆空则回收弃牌堆） */
function drawJudgeCard(state: SgsGameState): string | undefined {
  if (state.drawPile.length === 0 && state.discardPile.length > 0) {
    state.drawPile = shuffle(state.discardPile.splice(0));
  }
  return state.drawPile.pop();
}

/** 判定阶段（处理延时锦囊），按真实花色结算，返回是否跳过摸牌/出牌 */
function applyJudge(state: SgsGameState, seat: number): { skipDraw: boolean; skipPlay: boolean } {
  const p = state.players[seat];
  let skipDraw = false;
  let skipPlay = false;
  for (const cid of [...p.judge]) {
    const card = state.cards[cid];
    p.judge = p.judge.filter((x) => x !== cid);
    if (!card) continue;

    const jcId = drawJudgeCard(state);
    const jc = jcId ? state.cards[jcId] : undefined;

    if (card.trickKind === 'lightning') {
      // 闪电：判定牌为黑桃 2~9 → 命中 3 点伤害，否则传给下家
      if (jc && jc.suit === SgsSuit.SPADE && jc.number >= 2 && jc.number <= 9) {
        log(state, { type: 'judge', seat, cardId: cid, text: '闪电命中！' });
        if (jcId) state.discardPile.push(jcId);
        damage(state, seat, 3, -1, cid);
      } else {
        const next = nextAlive(state, seat);
        if (next !== seat) state.players[next].judge.push(cid);
        else state.discardPile.push(cid);
        log(state, { type: 'judge', seat, cardId: cid, text: '闪电转移至下家' });
        if (jcId) state.discardPile.push(jcId);
      }
    } else if (card.trickKind === 'indulgence') {
      // 乐不思蜀：判定牌非红桃 → 跳过出牌
      if (jc && jc.suit !== SgsSuit.HEART) {
        skipPlay = true;
        log(state, { type: 'judge', seat, cardId: cid, text: '乐不思蜀：本回合无法出牌' });
      } else {
        log(state, { type: 'judge', seat, cardId: cid, text: '乐不思蜀：判定生效（可出牌）' });
      }
      state.discardPile.push(cid);
      if (jcId) state.discardPile.push(jcId);
    } else if (card.trickKind === 'supply') {
      // 兵粮寸断：判定牌非梅花 → 跳过摸牌
      if (jc && jc.suit !== SgsSuit.CLUB) {
        skipDraw = true;
        log(state, { type: 'judge', seat, cardId: cid, text: '兵粮寸断：本回合无法摸牌' });
      } else {
        log(state, { type: 'judge', seat, cardId: cid, text: '兵粮寸断：判定生效（可摸牌）' });
      }
      state.discardPile.push(cid);
      if (jcId) state.discardPile.push(jcId);
    }
  }
  return { skipDraw, skipPlay };
}

/** 回合开始：判定 → 摸牌 → 进入出牌阶段 */
export function startTurn(state: SgsGameState, seat: number, runPrepareSkills = true): void {
  const p = state.players[seat];
  if (!p.isAlive) {
    advanceTurn(state);
    return;
  }
  state.turn = seat;
  state.phase = SgsPhase.PREPARE;
  p.shaCount = 0;
  state.drewThisTurn = false;
  log(state, { type: 'turn_start', seat, text: `${getHero(p.heroId)?.name ?? '玩家'} 的回合开始` });

  const { skipDraw, skipPlay } = applyJudge(state, seat);
  if (state.winner) return;

  // 准备阶段技能（甄姬·洛神 / 张辽·突袭）；返回 true 表示已自行处理摸牌
  let preparedSkipDraw = false;
  if (runPrepareSkills) {
    for (const sid of getHero(p.heroId)?.skills ?? []) {
      if (SKILLS[sid]?.onPrepare?.(state, seat)) preparedSkipDraw = true;
    }
  }

  if (!skipDraw && !preparedSkipDraw) {
    drawCards(state, seat, 2);
    state.drewThisTurn = true;
    log(state, { type: 'draw', seat, text: '摸 2 张牌' });
  }
  state.phase = skipPlay ? SgsPhase.END : SgsPhase.PLAY;
  if (skipPlay) log(state, { type: 'turn_start', seat, text: '跳过出牌阶段' });
}

/** 下一个存活座位 */
export function nextAlive(state: SgsGameState, from: number): number {
  for (let i = 1; i <= state.seats; i++) {
    const s = (from + i) % state.seats;
    if (state.players[s].isAlive) return s;
  }
  return from;
}

function advanceTurn(state: SgsGameState): void {
  const next = nextAlive(state, state.turn);
  state.round += next <= state.turn ? 1 : 0;
  startTurn(state, next);
}

/** 造成伤害（含死亡与技能钩子） */
export function damage(
  state: SgsGameState,
  target: number,
  amount: number,
  source: number,
  cardId?: string,
): void {
  const p = state.players[target];
  if (!p.isAlive || amount <= 0) return;
  p.hp -= amount;
  log(state, { type: 'damage', seat: target, target, cardId, text: `${getHero(p.heroId)?.name ?? '玩家'} 受到 ${amount} 点伤害` });
  // 受伤害后技能钩子（如曹操·奸雄）
  for (const sid of getHero(p.heroId)?.skills ?? []) {
    const sk = SKILLS[sid];
    sk?.onDamaged?.(state, target, source);
  }
  if (p.hp <= 0) die(state, target, source);
  checkWin(state);
}

/** 回复体力 */
export function heal(state: SgsGameState, seat: number, amount: number): void {
  const p = state.players[seat];
  if (!p.isAlive) return;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  log(state, { type: 'heal', seat, text: `${getHero(p.heroId)?.name ?? '玩家'} 回复 ${amount} 点体力` });
}

function die(state: SgsGameState, seat: number, source: number): void {
  const p = state.players[seat];
  p.isAlive = false;
  // 手牌与装备全部进入弃牌堆
  for (const id of p.hand) if (id) state.discardPile.push(id);
  p.hand = [];
  for (const slot of [p.weapon, p.armor, p.horsePlus, p.horseMinus]) {
    if (slot) state.discardPile.push(slot);
  }
  p.weapon = p.armor = p.horsePlus = p.horseMinus = null;
  log(state, { type: 'death', seat, target: source, text: `${getHero(p.heroId)?.name ?? '玩家'} 阵亡（身份：${p.identity}）` });
}

/** 胜负判定 */
export function checkWin(state: SgsGameState): void {
  if (state.winner) return;
  const alive = state.players.filter((p) => p.isAlive);
  const lord = state.players[state.lordSeat];
  const hasRebel = alive.some((p) => p.identity === Identity.REBEL);
  const hasLoyalist = alive.some((p) => p.identity === Identity.LOYALIST);
  const hasSpy = alive.some((p) => p.identity === Identity.SPY);

  // 兜底：回合上限到达仍无人分出胜负（极端僵局），按存活方判定，确保整局必然收敛
  if (state.round >= MAX_ROUNDS) {
    if (lord.isAlive) state.winner = Identity.LOYALIST;
    else if (hasRebel) state.winner = Identity.REBEL;
    else if (hasLoyalist) state.winner = Identity.LOYALIST;
    else state.winner = Identity.SPY;
    log(state, { type: 'win', text: `回合上限到达，按存活判定胜方：${state.winner}` });
    state.phase = SgsPhase.END;
    return;
  }

  if (!lord.isAlive) {
    if (hasRebel) state.winner = Identity.REBEL;
    else if (hasLoyalist) state.winner = Identity.LOYALIST;
    else state.winner = Identity.SPY;
    log(state, { type: 'win', text: `对局结束，胜方：${state.winner}` });
    state.phase = SgsPhase.END;
    return;
  }
  // 主公存活：反贼全灭
  if (!hasRebel) {
    if (!hasSpy) {
      state.winner = Identity.LOYALIST;
      log(state, { type: 'win', text: '反贼内奸全灭，主公方获胜' });
      state.phase = SgsPhase.END;
    }
    // 否则内奸尚存，继续（内奸需刺杀主公/忠臣）
  }
}

/** 出牌 */
export function playCard(
  prevState: SgsGameState,
  seat: number,
  action: SgsClientAction,
): SgsGameState {
  const state = clone(prevState);
  if (state.winner) throw new Error('对局已结束');
  if (state.pendingAsk) throw new Error('尚有未响应的请求');
  const p = state.players[seat];
  if (!p.isAlive) throw new Error('你已阵亡');
  if (state.turn !== seat || state.phase !== SgsPhase.PLAY)
    throw new Error('当前不是你的出牌阶段');

  if (action.type !== 'play') throw new Error('当前仅支持出牌');

  const ids = action.cardIds ?? [];
  if (ids.length === 0) throw new Error('未选择牌');
  for (const id of ids) {
    if (!findCard(state, seat, id)) throw new Error('手牌/装备中不存在该牌');
  }
  const main = state.cards[ids[0]];
  if (!main) throw new Error('卡牌不存在');

  // 从手牌移除（装备牌从装备区移除由 equip 处理）
  for (const id of ids) consumeFromHand(state, seat, id);

  // 关羽·武圣：红色手牌可当【杀】；赵云·龙胆：闪可当杀
  const useAsSha =
    main.defId === 'sha' ||
    (heroHasSkill(p.heroId, 'wusheng') &&
      isRed(main.suit) &&
      main.type !== SgsCardType.EQUIPMENT &&
      action.target != null) ||
    (heroHasSkill(p.heroId, 'longdan') &&
      main.defId === 'shan' &&
      action.target != null);

  if (useAsSha) {
    playSha(state, seat, action, ids[0]);
  } else
  switch (main.defId) {
    case 'sha':
      playSha(state, seat, action, ids[0]);
      break;
    case 'tao':
      playTao(state, seat, action);
      break;
    case 'wu_xie':
      playWuxie(state, seat);
      break;
    case 'jie_dou':
      startWuxieChain(state, seat, { type: 'duel', defId: 'jie_dou', target: action.target });
      break;
    case 'nan_man':
    case 'wan_jian':
      // AoE（南蛮/万箭）按原逻辑立即结算：群体锦囊的「逐目标无懈」留待后续迭代，
      // 避免无懈链把整张 AoE 抵消导致对局失去清场能力、拖长对局。
      playAoe(state, seat, main.defId);
      break;
    case 'tao_yuan':
      for (const pl of state.players) if (pl.isAlive) heal(state, pl.seat, 1);
      log(state, { type: 'play', seat, cardId: ids[0], text: '桃园结义：全场回复 1 体力' });
      break;
    case 'wu_zhong':
      drawCards(state, seat, 2);
      log(state, { type: 'play', seat, cardId: ids[0], text: '无中生有：摸 2 张' });
      break;
    case 'wu_gu':
      for (const pl of state.players) if (pl.isAlive) drawCards(state, pl.seat, 1);
      log(state, { type: 'play', seat, cardId: ids[0], text: '五谷丰登：每人摸 1 张' });
      break;
    case 'chai_qiao':
      startWuxieChain(state, seat, { type: 'dismantle', defId: 'chai_qiao', target: action.target, cardId: ids[0] });
      break;
    case 'shun_shou':
      startWuxieChain(state, seat, { type: 'snatch', defId: 'shun_shou', target: action.target, cardId: ids[0] });
      break;
    case 'shan_dian':
    case 'le_bu':
    case 'bing_liang':
      startWuxieChain(state, seat, { type: 'delayed', defId: main.defId, target: action.target ?? seat });
      break;
    default:
      // 装备牌
      if (main.type === SgsCardType.EQUIPMENT) {
        equip(state, seat, ids[0]);
      } else {
        state.discardPile.push(...ids);
        throw new Error('该牌暂不支持主动使用');
      }
      break;
  }
  if (!state.pendingAsk) triggerOnPlayTrick(state, seat, main);
  return state;
}

function playSha(state: SgsGameState, seat: number, action: any, cardId: string) {
  const p = state.players[seat];
  if (shaLimited(state, seat) && p.shaCount >= state.rules.baseShaLimit) {
    throw new Error('本回合出杀次数已达上限');
  }
  const target = action.target;
  if (target == null || !canAttack(state, seat, target)) {
    throw new Error('目标不在攻击范围内');
  }
  p.shaCount += 1;
  const wushuang = heroHasSkill(p.heroId, 'wushuang');
  state.pendingAsk = {
    kind: 'dodge',
    source: seat,
    target,
    cardId,
    wushuang,
    desc: `${getHero(p.heroId)?.name} 对你出【杀】${wushuang ? '（无双：需两张闪）' : ''}，是否出【闪】？`,
  };
  log(state, { type: 'play', seat, target, cardId, text: `${getHero(p.heroId)?.name} 使用【杀】` });
}

function playTao(state: SgsGameState, seat: number, action: any) {
  const target = action.target ?? seat;
  const tp = state.players[target];
  if (!tp.isAlive || tp.hp >= tp.maxHp) throw new Error('目标无需回复');
  heal(state, target, 1);
}

function playWuxie(state: SgsGameState, seat: number) {
  const p = state.players[seat];
  // 简化：无懈可击用于清除自身判定区的一张延时锦囊
  if (p.judge.length === 0) throw new Error('判定区无可清除的延时锦囊');
  const cid = p.judge.pop()!;
  state.discardPile.push(cid);
  log(state, { type: 'play', seat, cardId: cid, text: '无懈可击：清除一张延时锦囊' });
}

function playDuel(state: SgsGameState, seat: number, action: any) {
  const target = action.target;
  if (target == null || !state.players[target].isAlive) throw new Error('决斗目标无效');
  if (heroHasSkill(state.players[target].heroId, 'kongcheng') && state.players[target].hand.length === 0)
    throw new Error('目标处于空城，无法决斗');
  // 吕布·无双：任一方有无双，每步需出两张杀
  const wushuang =
    heroHasSkill(state.players[seat].heroId, 'wushuang') ||
    heroHasSkill(state.players[target].heroId, 'wushuang');
  log(state, { type: 'play', seat, target, text: '决斗！' });
  let attacker = seat;
  let defender = target;
  let guard = 0;
  while (guard++ < 40) {
    const def = state.players[defender];
    const need = wushuang ? 2 : 1;
    // 统计可用杀（含赵云·龙胆：闪当杀）
    const shaIdxs: number[] = [];
    for (let i = 0; i < def.hand.length && shaIdxs.length < need; i++) {
      const c = state.cards[def.hand[i]];
      if (!c) continue;
      if (c.defId === 'sha') shaIdxs.push(i);
      else if (heroHasSkill(def.heroId, 'longdan') && c.defId === 'shan') shaIdxs.push(i);
    }
    if (shaIdxs.length < need) {
      damage(state, defender, 1, attacker);
      return;
    }
    shaIdxs.sort((a, b) => b - a).forEach((i) => {
      state.discardPile.push(def.hand[i]);
      def.hand.splice(i, 1);
    });
    // 交换攻防
    [attacker, defender] = [defender, attacker];
  }
}

function playAoe(state: SgsGameState, seat: number, defId: CardDefId) {
  log(state, { type: 'play', seat, text: defId === 'nan_man' ? '南蛮入侵！' : '万箭齐发！' });
  for (const pl of state.players) {
    if (!pl.isAlive || pl.seat === seat) continue;
    const hasShan = pl.hand.some((id) => state.cards[id]?.defId === 'sha' || state.cards[id]?.defId === 'shan');
    const hasBagua = !!pl.armor && state.cards[pl.armor]?.defId === 'ba_gua';
    if (!hasShan && !hasBagua) {
      damage(state, pl.seat, 1, seat);
    } else if (hasShan) {
      const idx = pl.hand.findIndex((id) => state.cards[id].defId === 'shan');
      const usedId = pl.hand[idx];
      pl.hand.splice(idx, 1);
      state.discardPile.push(usedId);
      log(state, { type: 'dodge', seat: pl.seat, text: `${getHero(pl.heroId)?.name} 打出【闪】` });
    } else {
      log(state, { type: 'dodge', seat: pl.seat, text: `${getHero(pl.heroId)?.name} 八卦阵免闪` });
    }
  }
}

function playDismantle(state: SgsGameState, seat: number, action: any, cardId: string) {
  const target = action.target;
  if (target == null) throw new Error('需指定目标');
  const tp = state.players[target];
  if (!tp.isAlive) throw new Error('目标无效');
  const pool = [...tp.hand, tp.weapon, tp.armor, tp.horsePlus, tp.horseMinus].filter(Boolean) as string[];
  if (pool.length === 0) {
    state.discardPile.push(cardId);
    return;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  removeAnywhere(state, target, pick);
  state.discardPile.push(pick);
  log(state, { type: 'play', seat, target, text: '过河拆桥：弃置对方一张牌' });
}

function playSnatch(state: SgsGameState, seat: number, action: any, cardId: string) {
  const target = action.target;
  if (target == null) throw new Error('需指定目标');
  const tp = state.players[target];
  if (!tp.isAlive) throw new Error('目标无效');
  if (effectiveDistance(state, seat, target) > 1) {
    state.discardPile.push(cardId);
    throw new Error('顺手牵羊：目标需在相邻座位');
  }
  const pool = [...tp.hand, tp.weapon, tp.armor, tp.horsePlus, tp.horseMinus].filter(Boolean) as string[];
  if (pool.length === 0) {
    state.discardPile.push(cardId);
    return;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  removeAnywhere(state, target, pick);
  state.players[seat].hand.push(pick);
  log(state, { type: 'play', seat, target, text: '顺手牵羊：获得对方一张牌' });
}

function playDelayedTrick(state: SgsGameState, seat: number, action: any, cardId: string, defId: CardDefId) {
  const target = action.target ?? seat;
  const tp = state.players[target];
  if (!tp.isAlive) throw new Error('目标无效');
  // 延时锦囊进入判定区，需从「已使用」弃牌堆中撤回其 id（避免重复计数）
  const di = state.discardPile.indexOf(cardId);
  if (di >= 0) state.discardPile.splice(di, 1);
  tp.judge.push(cardId);
  const name = defId === 'shan_dian' ? '闪电' : defId === 'le_bu' ? '乐不思蜀' : '兵粮寸断';
  log(state, { type: 'play', seat, target, cardId, text: `${name} 进入 ${getHero(tp.heroId)?.name} 的判定区` });
}

/**
 * 发起无懈可击响应链：除来源外的所有存活玩家按行动顺序可依次打出无懈可击，
 * 每打出一张无懈可击就翻转一次「是否已抵消」，链结束后据此结算锦囊。
 */
function startWuxieChain(state: SgsGameState, source: number, trick: SgsPendingTrick) {
  const queue: number[] = [];
  for (let i = 1; i <= state.seats; i++) {
    const s = (source + i) % state.seats;
    if (state.players[s].isAlive && s !== source) queue.push(s);
  }
  if (queue.length === 0) {
    // 无其他人可响应，直接结算
    resolvePendingTrick(state, {
      kind: 'wuxie',
      source,
      target: source,
      cardId: trick.cardId,
      desc: '',
      negated: false,
      queue: [],
      pendingTrick: trick,
    });
    return;
  }
  const target = queue.shift()!;
  state.pendingAsk = {
    kind: 'wuxie',
    source,
    target,
    cardId: trick.cardId,
    desc: `是否对【${trickName(trick.defId)}】使用无懈可击？`,
    negated: false,
    queue,
    pendingTrick: trick,
  };
  log(state, {
    type: 'play',
    seat: source,
    cardId: trick.cardId,
    text: `${getHero(state.players[source].heroId)?.name} 使用【${trickName(trick.defId)}】`,
  });
}

/** 无懈可击链结束后的结算（按最终是否已抵消决定是否生效） */
function resolvePendingTrick(state: SgsGameState, ask: SgsPendingAsk) {
  const t = ask.pendingTrick;
  if (!t) {
    state.pendingAsk = null;
    return;
  }
  if (ask.negated) {
    log(state, {
      type: 'skill',
      seat: ask.source,
      text: `【${trickName(t.defId)}】被无懈可击抵消，失效`,
    });
    state.pendingAsk = null;
    return;
  }
  if (t.type === 'aoe') playAoe(state, ask.source, t.defId!);
  else if (t.type === 'duel') playDuel(state, ask.source, { type: 'play', target: t.target });
  else if (t.type === 'dismantle') playDismantle(state, ask.source, { type: 'play', target: t.target }, t.cardId!);
  else if (t.type === 'snatch') playSnatch(state, ask.source, { type: 'play', target: t.target }, t.cardId!);
  else if (t.type === 'delayed')
    playDelayedTrick(state, ask.source, { type: 'play', target: t.target }, t.cardId!, t.defId!);
  const card = t.cardId ? state.cards[t.cardId] : undefined;
  triggerOnPlayTrick(state, ask.source, card);
  state.pendingAsk = null;
}

/** 使用锦囊后的技能钩子（如黄月英·集智：摸一张） */
function triggerOnPlayTrick(state: SgsGameState, seat: number, card?: SgsCard) {
  if (!card || card.type !== SgsCardType.TRICK) return;
  if (heroHasSkill(state.players[seat].heroId, 'jiqi')) {
    drawCards(state, seat, 1);
    log(state, {
      type: 'skill',
      seat,
      text: `${getHero(state.players[seat].heroId)?.name} 发动【集智】，摸一张牌`,
    });
  }
}

function equip(state: SgsGameState, seat: number, cardId: string) {
  const p = state.players[seat];
  const card = state.cards[cardId];
  if (!card?.equipType) throw new Error('非装备牌');
  const slotFor: Record<SgsEquipType, 'weapon' | 'armor' | 'horsePlus' | 'horseMinus'> = {
    [SgsEquipType.WEAPON]: 'weapon',
    [SgsEquipType.ARMOR]: 'armor',
    [SgsEquipType.HORSE_PLUS]: 'horsePlus',
    [SgsEquipType.HORSE_MINUS]: 'horseMinus',
  };
  const slot = slotFor[card.equipType];
  const old = p[slot];
  if (old) state.discardPile.push(old);
  // 装备牌进入装备区，需从「已使用」弃牌堆中撤回其 id（避免重复计数）
  const di = state.discardPile.indexOf(cardId);
  if (di >= 0) state.discardPile.splice(di, 1);
  p[slot] = cardId;
  log(state, { type: 'equip', seat, cardId, text: `${getHero(p.heroId)?.name} 装备 ${card.name}` });
}

function removeAnywhere(state: SgsGameState, seat: number, cardId: string) {
  const p = state.players[seat];
  const i = p.hand.indexOf(cardId);
  if (i !== -1) {
    p.hand.splice(i, 1);
    return;
  }
  for (const slot of ['weapon', 'armor', 'horsePlus', 'horseMinus'] as const) {
    if (p[slot] === cardId) p[slot] = null;
  }
}

/** 响应（闪 / 无懈等） */
export function respond(
  prevState: SgsGameState,
  seat: number,
  action: SgsClientAction,
): SgsGameState {
  const state = clone(prevState);
  const ask = state.pendingAsk;
  if (!ask) throw new Error('当前无需响应');
  if (seat !== ask.target) throw new Error('不是你的响应时机');

  if (ask.kind === 'wuxie') {
    if (action.type === 'respond' && action.wuxie) {
      const wuxieId = state.players[seat].hand.find((id) => state.cards[id]?.defId === 'wu_xie');
      if (wuxieId) {
        consumeFromHand(state, seat, wuxieId);
        ask.negated = !ask.negated;
        log(state, {
          type: 'skill',
          seat,
          cardId: wuxieId,
          text: `${getHero(state.players[seat].heroId)?.name} 使用【无懈可击】`,
        });
      }
    }
    if (ask.queue && ask.queue.length) {
      ask.target = ask.queue.shift()!;
      state.pendingAsk = ask;
      return state;
    }
    resolvePendingTrick(state, ask);
    return state;
  }

  if (ask.kind === 'dodge') {
    const tp = state.players[seat];
    const hasBagua = !!tp.armor && state.cards[tp.armor]?.defId === 'ba_gua';
    // 吕布·无双：需两张闪/杀/黑牌响应
    const need = ask.wushuang && !hasBagua ? 2 : 1;
    const isShan = (id: string) => state.cards[id]?.defId === 'shan';
    const isLongdanSha = (id: string) =>
      heroHasSkill(tp.heroId, 'longdan') && state.cards[id]?.defId === 'sha';
    const isQingguo = (id: string) => {
      const c = state.cards[id];
      return (
        heroHasSkill(tp.heroId, 'qingguo') &&
        !!c && c.type !== SgsCardType.EQUIPMENT && (c.suit === 'spade' || c.suit === 'club')
      );
    };
    // 按优先级（闪 > 龙胆杀 > 倾国黑）选出 need 张当闪牌
    const pickDodgeCards = (): number[] => {
      const chosen: number[] = [];
      const preds = [isShan, isLongdanSha, isQingguo];
      for (const pred of preds) {
        for (let i = 0; i < tp.hand.length && chosen.length < need; i++) {
          if (!chosen.includes(i) && pred(tp.hand[i])) chosen.push(i);
        }
        if (chosen.length >= need) break;
      }
      return chosen;
    };
    const baguaProtect = hasBagua;
    const responded = baguaProtect || (action.type === 'respond' && action.dodge && pickDodgeCards().length >= need);
    if (responded) {
      if (!baguaProtect) {
        pickDodgeCards()
          .sort((a, b) => b - a)
          .forEach((i) => {
            state.discardPile.push(tp.hand[i]);
            tp.hand.splice(i, 1);
          });
      }
      log(state, { type: 'dodge', seat, text: `${getHero(tp.heroId)?.name} 打出${need}张【闪】` });
    } else {
      // 黄忠·烈弓：目标手牌数 ≤ 攻击范围时，杀伤害 +1
      const srcHero = state.players[ask.source]?.heroId;
      const extra =
        heroHasSkill(srcHero, 'liegong') && tp.hand.length <= weaponRange(state, ask.source) ? 1 : 0;
      damage(state, seat, 1 + extra, ask.source, ask.cardId);
    }
    state.pendingAsk = null;
  }
  return state;
}

/** 结束出牌阶段 */
export function endTurn(prevState: SgsGameState, seat: number): SgsGameState {
  const state = clone(prevState);
  if (state.winner) throw new Error('对局已结束');
  if (state.turn !== seat) throw new Error('不是你的回合');
  const p = state.players[seat];
  // 弃牌至体力上限
  while (p.hand.length > p.maxHp) {
    const id = p.hand.pop();
    if (id) state.discardPile.push(id);
  }
  log(state, { type: 'discard', seat, text: `${getHero(p.heroId)?.name} 弃牌至 ${p.maxHp} 张` });
  // 回合结束技能（如貂蝉·闭月）
  for (const sid of getHero(p.heroId)?.skills ?? []) {
    SKILLS[sid]?.onTurnEnd?.(state, seat);
  }
  state.phase = SgsPhase.END;
  advanceTurn(state);
  checkWin(state);
  return state;
}

/** 主动技能（制衡 / 青囊） */
export function useSkill(
  prevState: SgsGameState,
  seat: number,
  skillId: string,
  opts: { cardIds?: string[]; target?: number } = {},
): SgsGameState {
  const state = clone(prevState);
  if (state.turn !== seat || state.phase !== SgsPhase.PLAY)
    throw new Error('仅出牌阶段可使用技能');
  const p = state.players[seat];
  if (!heroHasSkill(p.heroId, skillId)) throw new Error('该武将无此技能');

  if (skillId === 'zhibeng') {
    const ids = opts.cardIds ?? [];
    for (const id of ids) consumeFromHand(state, seat, id);
    drawCards(state, seat, ids.length);
    log(state, { type: 'skill', seat, text: '孙权发动【制衡】' });
  } else if (skillId === 'qingnang') {
    const ids = opts.cardIds ?? [];
    if (ids.length < 1) throw new Error('需弃置一张手牌');
    consumeFromHand(state, seat, ids[0]);
    const t = opts.target ?? seat;
    if (!state.players[t].isAlive) throw new Error('目标无效');
    heal(state, t, 1);
    log(state, { type: 'skill', seat, text: '华佗发动【青囊】' });
  } else if (skillId === 'qixi') {
    const id = (opts.cardIds ?? [])[0];
    if (!id) throw new Error('需选择一张手牌');
    const c = state.cards[id];
    if (!c || !p.hand.includes(id)) throw new Error('需选择手牌');
    if (c.suit !== 'spade' && c.suit !== 'club') throw new Error('奇袭需使用黑色牌');
    const target = opts.target;
    if (target == null || target === seat || !state.players[target].isAlive) throw new Error('目标无效');
    consumeFromHand(state, seat, id);
    state.discardPile.push(id);
    const tp = state.players[target];
    const pool = [tp.weapon, tp.armor, tp.horsePlus, tp.horseMinus].filter(Boolean) as string[];
    pool.push(...tp.hand);
    if (pool.length > 0) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      removeAnywhere(state, target, pick);
      state.discardPile.push(pick);
    }
    log(state, { type: 'skill', seat, target, text: '甘宁发动【奇袭】，过河拆桥' });
  } else {
    throw new Error('该技能暂不支持主动发动');
  }
  return state;
}

// 重导出技能查询，便于上层模块（table service）直接使用
export { getHero, HEROES, SKILLS, heroHasSkill } from './skills';
