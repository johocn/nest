/**
 * 斗地主对局状态机（纯逻辑，零框架依赖，可 vitest 测试）。
 * 流程：start() → 发牌 → bidding（叫分定地主）→ playing（轮流出牌/不出）→ over（分胜负）。
 * 玩法约定（简化版，便于单人可玩）：
 *   - 3 家各 17 张，底牌 3 张归地主。
 *   - 抢地主轮：三家依次选择 抢 / 明牌抢（额外 ×2）/ 不抢，最后抢者当地主；无人抢则重发牌（最多 4 次后强制首叫者当地主）。
 *   - 出牌需 beat 上一手有效牌；连续两家「不出」则回到上一手出牌者自由出牌。
 *   - 炸弹/火箭使倍数 ×2。某家手牌出完即结束：地主出完=地主胜，农民出完=农民胜。
 * 外部（UI / AI / 测试）通过 current / lastPlay / hands 等状态驱动；本类不内置 AI。
 */

import {
  Card,
  buildDeck,
  shuffle,
  deal,
  sortHand,
  containsCards,
} from './cards';
import { identify, canBeat, CardType } from './rules';

export type Phase = 'idle' | 'bidding' | 'doubling' | 'playing' | 'over';

/** 加倍决策：不加倍(×1) / 加倍(×2) / 超级加倍(×4) */
export type DoubleAction = 'none' | 'double' | 'super';

export type GameEventType = 'deal' | 'bid' | 'play' | 'pass' | 'over';

export interface GameEvent {
  type: GameEventType;
  player?: number;
  cards?: Card[];
  cardType?: CardType;
  landlord?: number;
  winner?: number;
  landlordWin?: boolean;
}

export interface GameOptions {
  rng?: () => number;
  onEvent?: (e: GameEvent) => void;
  baseScore?: number;
  /** 加倍阶段（定地主后一轮 不加倍/加倍/超级加倍）。默认关，由 UI 开启 */
  doubleMode?: boolean;
  /** 不洗牌：发牌跳过 shuffle，牌按 buildDeck 固定顺序发出，可记牌预测 */
  noShuffle?: boolean;
}

export interface BidResult {
  done: boolean;
  landlord: number;
  redeal?: boolean;
}

export class DoudizhuGame {
  hands: Card[][] = [[], [], []];
  bottom: Card[] = [];
  landlord = -1;
  phase: Phase = 'idle';
  current = 0;
  lastPlay: { player: number; cards: Card[]; type: CardType } | null = null;
  lastValidPlayer = -1;
  bids: number[] = []; // 兼容旧叫分/测试
  grabs: boolean[] = [];
  mingpaiSeat = -1; // 明牌抢地主的座位（-1 表示无）
  firstBidder = 0; // 首叫者
  redealCount = 0; // 重发次数
  winner = -1;
  landlordWin = false;
  multiplier = 1;
  /** 各玩家出牌次数（用于春天/反春天判定）。 */
  playCount: [number, number, number] = [0, 0, 0];
  /** 春天类型：'' | 'spring' | 'antispring'，供 UI 展示。 */
  spring = '';
  baseScore = 1;
  scores: [number, number, number] = [0, 0, 0];
  /** 加倍阶段开关（默认关，UI 按设置开启） */
  doubleMode = false;
  /** 加倍阶段：三家各自的决策 */
  doubleDecisions: (DoubleAction | undefined)[] = [];
  rng: () => number;
  private onEvent?: (e: GameEvent) => void;
  /** 不洗牌标记（构造时设定，start 时可被 opts 覆盖） */
  noShuffle = false;

  constructor(opts?: GameOptions) {
    this.rng = (opts && opts.rng) || Math.random;
    this.onEvent = opts && opts.onEvent;
    this.baseScore = (opts && opts.baseScore) || 1;
    this.doubleMode = !!(opts && opts.doubleMode);
    this.noShuffle = !!(opts && opts.noShuffle);
  }

  private emit(e: GameEvent): void {
    if (this.onEvent) this.onEvent(e);
  }

  start(opts?: { noShuffle?: boolean }): void {
    const noShuffle = !!(opts && opts.noShuffle) || this.noShuffle;
    const deck = noShuffle ? buildDeck() : shuffle(buildDeck(), this.rng);
    const d = deal(deck);
    this.hands = d.hands;
    this.bottom = d.bottom;
    this.phase = 'bidding';
    this.firstBidder = Math.floor(this.rng() * 3);
    this.current = this.firstBidder;
    this.bids = [];
    this.grabs = [];
    this.mingpaiSeat = -1;
    this.redealCount = 0;
    this.landlord = -1;
    this.lastPlay = null;
    this.lastValidPlayer = -1;
    this.winner = -1;
    this.landlordWin = false;
    this.multiplier = 1;
    this.playCount = [0, 0, 0];
    this.spring = '';
    this.scores = [0, 0, 0];
    this.doubleDecisions = [];
    this.emit({ type: 'deal' });
  }

  /** 出牌轮转：0→2→1→0（与单机版一致：我→右家→左家）。联机一致性契约，勿单端改动。 */
  private nextSeat(s: number): number {
    return s === 0 ? 2 : s === 2 ? 1 : 0;
  }

  /** 抢地主（仅 bidding 阶段）。choice: 抢 / 明牌抢（额外 ×2）/ 不抢。最后抢者当地主；无人抢则重发。 */
  grab(seat: number, choice: 'grab' | 'mingpai' | 'nograb'): BidResult {
    if (this.phase !== 'bidding' || seat !== this.current)
      return { done: false, landlord: -1 };
    const grab = choice !== 'nograb';
    if (choice === 'mingpai') this.mingpaiSeat = seat;
    this.grabs[seat] = grab;
    this.emit({ type: 'bid', player: seat });
    this.current = this.nextSeat(this.current);
    if (this.grabs.filter((b) => b !== undefined).length >= 3) {
      let lord = -1;
      // 按轮转链从首叫者起取“最后抢者”
      let s = this.firstBidder;
      for (let k = 0; k < 3; k++) {
        if (this.grabs[s]) lord = s;
        s = this.nextSeat(s);
      }
      if (lord === -1) {
        this.redealCount += 1;
        if (this.redealCount > 3) {
          lord = this.firstBidder;
          this.grabs[this.firstBidder] = true;
        } else return { done: false, landlord: -1, redeal: true };
      }
      return this.finishBidding(lord);
    }
    return { done: false, landlord: -1 };
  }

  /** 兼容旧叫分 / 测试：score 0=不抢，1/2=抢，3=明牌抢。 */
  bid(score: number): BidResult {
    const choice: 'grab' | 'mingpai' | 'nograb' =
      score <= 0 ? 'nograb' : score >= 3 ? 'mingpai' : 'grab';
    this.bids[this.current] = score;
    return this.grab(this.current, choice);
  }

  private finishBidding(lord: number): BidResult {
    this.landlord = lord;
    this.hands[lord] = sortHand(this.hands[lord].concat(this.bottom));
    this.phase = 'playing';
    this.current = lord;
    this.lastPlay = null;
    this.lastValidPlayer = -1;
    // 倍数基数：抢地主固定 1 倍；明牌抢地主额外 ×2（炸弹 / 春天在出牌阶段继续叠加）
    this.multiplier = this.mingpaiSeat >= 0 ? 2 : 1;
    // 加倍阶段：地主与农民各决策一次后再进入出牌
    if (this.doubleMode) {
      this.phase = 'doubling';
      this.current = lord;
      this.doubleDecisions = [];
      this.emit({ type: 'bid', player: lord, landlord: lord });
      return { done: true, landlord: lord };
    }
    this.emit({ type: 'bid', player: lord, landlord: lord });
    return { done: true, landlord: lord };
  }

  /**
   * 加倍（仅 doubling 阶段）。三家各决策一次：none=不加倍(×1) / double=加倍(×2) / super=超级加倍(×4)。
   * 集满三家后进入 playing，倍数已累计进 multiplier。
   */
  double(action: DoubleAction): BidResult {
    if (this.phase !== 'doubling') return { done: false, landlord: -1 };
    this.doubleDecisions[this.current] = action;
    if (action === 'double') this.multiplier *= 2;
    else if (action === 'super') this.multiplier *= 4;
    this.emit({ type: 'bid', player: this.current, landlord: -1 });
    this.current = this.nextSeat(this.current);
    if (this.doubleDecisions.filter((d) => d !== undefined).length >= 3) {
      this.phase = 'playing';
      return { done: true, landlord: this.landlord };
    }
    return { done: false, landlord: -1 };
  }

  /** 校验某玩家出这组牌是否合法（归属 / 牌型 / 是否压得过）。 */
  canPlay(player: number, cards: Card[]): { ok: boolean; reason?: string } {
    if (this.phase !== 'playing') return { ok: false, reason: 'not playing' };
    if (player !== this.current) return { ok: false, reason: 'not your turn' };
    if (!cards || cards.length === 0) return { ok: false, reason: 'empty' };
    if (!containsCards(this.hands[player], cards))
      return { ok: false, reason: 'not in hand' };
    const t = identify(cards);
    if (!t) return { ok: false, reason: 'invalid type' };
    // 自由出牌（无上一手 或 上一手是自己）无需压牌
    if (
      this.lastPlay &&
      this.lastPlay.player !== player &&
      !canBeat(this.lastPlay.type, t)
    ) {
      return { ok: false, reason: 'cannot beat' };
    }
    return { ok: true };
  }

  /** 执行出牌。成功返回 true。 */
  play(player: number, cards: Card[]): boolean {
    const chk = this.canPlay(player, cards);
    if (!chk.ok) return false;
    const pool = this.hands[player].slice();
    for (const c of cards) {
      const idx = pool.findIndex((p) => p.id === c.id);
      if (idx >= 0) pool.splice(idx, 1);
    }
    this.hands[player] = pool;
    const t = identify(cards)!;
    this.lastPlay = { player, cards, type: t };
    this.lastValidPlayer = player;
    this.playCount[player] += 1;
    if (t.type === 'bomb' || t.type === 'rocket') this.multiplier *= 2;
    this.emit({ type: 'play', player, cards, cardType: t });

    if (this.hands[player].length === 0) {
      this.winner = player;
      this.landlordWin = player === this.landlord;
      this.phase = 'over';
      this.computeScores();
      this.emit({
        type: 'over',
        winner: player,
        landlordWin: this.landlordWin,
      });
      return true;
    }
    this.current = this.nextSeat(player);
    return true;
  }

  /** 不出（pass）。自由出牌时不允许 pass。 */
  pass(player: number): boolean {
    if (this.phase !== 'playing') return false;
    if (player !== this.current) return false;
    if (!this.lastPlay || this.lastPlay.player === player) return false; // 自由出牌不能 pass
    this.emit({ type: 'pass', player });
    this.current = this.nextSeat(player);
    // 回到上一手有效出牌者 → 新一圈自由出牌
    if (this.current === this.lastValidPlayer) {
      this.lastPlay = null;
    }
    return true;
  }

  private computeScores(): void {
    const b = this.baseScore;
    // 春天 / 反春天额外 ×2（先翻倍，再取最终倍数参与结算，保证展示与结算一致）
    if (
      this.landlordWin &&
      this.playCount[1] === 0 &&
      this.playCount[2] === 0
    ) {
      this.spring = 'spring';
      this.multiplier *= 2;
    } else if (!this.landlordWin && this.playCount[this.landlord] === 1) {
      this.spring = 'antispring';
      this.multiplier *= 2;
    }
    const m = this.multiplier;
    if (this.landlordWin) {
      this.scores[this.landlord] = 2 * b * m;
      for (let i = 0; i < 3; i++)
        if (i !== this.landlord) this.scores[i] = -b * m;
    } else {
      this.scores[this.landlord] = -2 * b * m;
      for (let i = 0; i < 3; i++)
        if (i !== this.landlord) this.scores[i] = b * m;
    }
  }
}
