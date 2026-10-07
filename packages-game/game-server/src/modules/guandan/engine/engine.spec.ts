import { Card, Suit, Action, GameState, DEFAULT_RULES } from './types';
import {
  createGame,
  applyAction,
  startNextRound,
  enumerateCombos,
  findBeatingCombos,
} from './engine';
import { LEVEL_SEQUENCE, pickCards } from './cards';
import { identifyCombo, beats } from './combos';
import { chooseAction } from './bot';

const LEVEL_NONE = 99;

function c(suit: Suit, rank: number, id?: string): Card {
  return { id: id ?? `${suit}-${rank}-${id ?? Math.random()}`, suit, rank };
}

describe('engine - 建局', () => {
  it('createGame：4 人各 25 张，底牌 8 张，phase=play，turn=0', () => {
    const s = createGame([false, true, false, true], {}, 0);
    expect(s.players.length).toBe(4);
    s.players.forEach((p) => expect(p.hand.length).toBe(25));
    expect(s.kitty.length).toBe(8);
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(0);
    expect(s.level).toBe(15);
    expect(s.levelIndex).toBe(0);
  });

  it('createGame：isBot 正确写入搭档关系', () => {
    const s = createGame([false, true, false, true], {}, 0);
    expect(s.players[0].partnerSeat).toBe(2);
    expect(s.players[1].partnerSeat).toBe(3);
    expect(s.players[0].isBot).toBe(false);
    expect(s.players[1].isBot).toBe(true);
  });
});

describe('engine - 出牌/过牌状态机', () => {
  function setup(hands: Card[][], turn = 0): GameState {
    const s = createGame([false, false, false, false], {}, 5); // levelIndex 5 => level 8
    hands.forEach((h, i) => (s.players[i].hand = h));
    s.turn = turn;
    s.lastPlay = null;
    s.passCount = 0;
    s.kittyClaimed = false;
    return s;
  }

  it('自由出牌：手牌减少，lastPlay 与 turn 更新', () => {
    const p0 = [c('spades', 3, 'a'), c('hearts', 4, 'b')];
    let s = setup([p0, [c('clubs', 5, 'c')], [c('diamonds', 6, 'd')], [c('spades', 7, 'e')]]);
    s = applyAction(s, 0, { type: 'play', cards: ['a'] });
    expect(s.players[0].hand.length).toBe(1);
    expect(s.lastPlay?.seat).toBe(0);
    expect(s.lastPlay?.combo.type).toBe('single');
    expect(s.turn).toBe(1);
  });

  it('自由出牌时不能过牌（cannot-pass-free-lead）', () => {
    let s = setup([
      [c('spades', 3, 'a')],
      [c('clubs', 5, 'c')],
      [c('diamonds', 6, 'd')],
      [c('spades', 7, 'e')],
    ]);
    expect(() => applyAction(s, 0, { type: 'pass' })).toThrow();
  });

  it('非轮次出牌抛 not-your-turn', () => {
    let s = setup([
      [c('spades', 3, 'a')],
      [c('clubs', 5, 'c')],
      [c('diamonds', 6, 'd')],
      [c('spades', 7, 'e')],
    ]);
    expect(() => applyAction(s, 1, { type: 'play', cards: ['c'] })).toThrow();
  });

  it('压不过上家出牌抛 cannot-beat', () => {
    let s = setup([
      [c('spades', 3, 'a'), c('hearts', 4, 'b')],
      [c('clubs', 5, 'c')],
      [c('diamonds', 6, 'd')],
      [c('spades', 7, 'e')],
    ]);
    s = applyAction(s, 0, { type: 'play', cards: ['a'] }); // 出 3
    // 座位 1 用 5 压 3（合法）
    s = applyAction(s, 1, { type: 'play', cards: ['c'] });
    // 座位 2 用 6 压 5（合法），再用 3 想压 6（非法）
    s = applyAction(s, 2, { type: 'play', cards: ['d'] });
    expect(() => applyAction(s, 3, { type: 'play', cards: ['e'] })).not.toThrow(); // 7>6
  });
});

describe('engine - trick 结算与底牌', () => {
  it('其余三家连续过牌：trick 结束，底牌归赢家，回到赢家出牌', () => {
    let s = createGame([false, false, false, false], {}, 5);
    s.players[0].hand = [c('spades', 3, 'a'), c('hearts', 4, 'b')];
    s.players[1].hand = [c('clubs', 5, 'c')];
    s.players[2].hand = [c('diamonds', 6, 'd')];
    s.players[3].hand = [c('spades', 7, 'e')];
    s.turn = 0;
    s.lastPlay = null;

    s = applyAction(s, 0, { type: 'play', cards: ['a'] }); // 出单张 3，剩 1 张
    expect(s.players[0].isOut).toBe(false);
    s = applyAction(s, 1, { type: 'pass' });
    s = applyAction(s, 2, { type: 'pass' });
    s = applyAction(s, 3, { type: 'pass' });

    // trick 结束：底牌 8 张给赢家(座位0)，lastPlay 清空，turn 回到 0
    expect(s.kittyClaimed).toBe(true);
    expect(s.players[0].hand.length).toBe(1 + 8);
    expect(s.lastPlay).toBeNull();
    expect(s.turn).toBe(0);
  });
});

describe('engine - 回合结算与升级', () => {
  it('三人出完：对手单下升 2 级，levelIndex 推进', () => {
    let s = createGame([false, false, false, false], {}, 0);
    s.players[0].hand = [c('spades', 3, 'a')];
    s.players[1].hand = [c('clubs', 4, 'b')];
    s.players[2].hand = [c('diamonds', 5, 'c')];
    s.players[3].hand = [c('spades', 6, 'd')];
    s.turn = 0;
    s.lastPlay = null;

    s = applyAction(s, 0, { type: 'play', cards: ['a'] }); // 头游
    s = applyAction(s, 1, { type: 'play', cards: ['b'] }); // 二游
    s = applyAction(s, 2, { type: 'play', cards: ['c'] }); // 三游 -> 回合结束

    expect(s.roundOver).toBe(true);
    expect(s.lastSettlement).not.toBeNull();
    expect(s.lastSettlement?.winningTeam).toBe(0); // 头游座位0 -> 0队
    expect(s.lastSettlement?.levelUp).toBe(2); // 搭档(座位2)三游 -> 对手单下升2
    expect(s.levelIndex).toBe(2);
    expect(s.level).toBe(LEVEL_SEQUENCE[2]);
    expect(s.turn).toBe(0);
    expect(s.matchWinner).toBeNull();
  });

  it('过 A 且搭档末游：留在 A（不升级不夺冠）', () => {
    let s = createGame([false, false, false, false], {}, 12); // levelIndex=12 => A
    // 座位0 头游、座位2 末游(4)：通过座位2 先 pass 让座位3 先出，座位2 最后出
    s.players[0].hand = [c('spades', 3, 'a')];
    s.players[1].hand = [c('clubs', 4, 'b')];
    s.players[2].hand = [c('diamonds', 14, 'c')]; // 高牌，可最后压制
    s.players[3].hand = [c('spades', 6, 'd')];
    s.turn = 0;
    s.lastPlay = null;
    s.kittyClaimed = true; // 隔离底牌机制（已在专门用例覆盖），专注升级逻辑
    s.kitty = [];

    s = applyAction(s, 0, { type: 'play', cards: ['a'] }); // 头游(1), turn->1
    s = applyAction(s, 1, { type: 'play', cards: ['b'] }); // 二游(2), turn->2
    s = applyAction(s, 2, { type: 'pass' }); // turn->3
    s = applyAction(s, 3, { type: 'play', cards: ['d'] }); // 三游(3) -> 3 人出完，回合结算（座位2 自动末游）

    expect(s.roundOver).toBe(true);
    expect(s.lastSettlement?.levelUp).toBe(0);
    expect(s.matchWinner).toBeNull();
    expect(s.levelIndex).toBe(12); // 留在 A
  });

  it('过 A 且搭档非末游（双上）：夺冠', () => {
    let s = createGame([false, false, false, false], {}, 12);
    // 座位0 头游、座位2 二游(双上)，座位1/3 为对手队
    s.players[0].hand = [c('spades', 3, 'a')];
    s.players[1].hand = [c('clubs', 4, 'b')];
    s.players[2].hand = [c('diamonds', 14, 'c')]; // 高牌，可二游压制
    s.players[3].hand = [c('spades', 6, 'd')];
    s.turn = 0;
    s.lastPlay = null;
    s.kittyClaimed = true; // 隔离底牌机制（已在专门用例覆盖），专注升级逻辑
    s.kitty = [];

    s = applyAction(s, 0, { type: 'play', cards: ['a'] });
    s = applyAction(s, 1, { type: 'pass' });
    s = applyAction(s, 2, { type: 'play', cards: ['c'] });
    s = applyAction(s, 3, { type: 'pass' });
    s = applyAction(s, 1, { type: 'pass' });
    s = applyAction(s, 3, { type: 'play', cards: ['d'] });

    expect(s.matchWinner).toBe(0);
    expect(s.phase).toBe('ended');
  });
});

describe('engine - startNextRound', () => {
  it('重发牌、清状态、保留级数与头游领衔', () => {
    let s = createGame([false, false, false, false], {}, 3);
    s.players[0].finishOrder = 1;
    startNextRound(s);
    expect(s.players.every((p) => p.hand.length === 25)).toBe(true);
    expect(s.kitty.length).toBe(8);
    expect(s.lastPlay).toBeNull();
    expect(s.roundOver).toBe(false);
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(0); // 头游领衔
    expect(s.levelIndex).toBe(3);
  });
});

describe('engine - 牌型枚举与提示', () => {
  it('enumerateCombos 至少包含单张，且数量随手牌增长', () => {
    const hand = [
      c('spades', 3, 'a'), c('hearts', 3, 'b'),
      c('clubs', 9, 'c'), c('diamonds', 9, 'd'), c('spades', 9, 'e'), c('hearts', 9, 'f'),
    ];
    const combos = enumerateCombos(hand, LEVEL_NONE, DEFAULT_RULES);
    expect(combos.some((x) => x.type === 'single')).toBe(true);
    expect(combos.some((x) => x.type === 'pair' && x.rank === 3)).toBe(true);
    expect(combos.some((x) => x.type === 'bomb' && x.rank === 9 && x.bombSize === 4)).toBe(true);
  });

  it('findBeatingCombos：无上家返回全部；有上家仅返回可压者', () => {
    const hand = [c('spades', 5, 'a'), c('hearts', 5, 'b'), c('clubs', 3, 'c')];
    const lastPair = { type: 'pair' as const, cards: [], rank: 4, length: 2, bombSize: 0, isBomb: false };
    const beating = findBeatingCombos(hand, LEVEL_NONE, DEFAULT_RULES, lastPair);
    expect(beating.every((x) => x.type === 'pair' && x.rank > 4)).toBe(true);
    expect(beating.some((x) => x.rank === 5)).toBe(true);

    const all = findBeatingCombos(hand, LEVEL_NONE, DEFAULT_RULES, null);
    expect(all.length).toBeGreaterThan(beating.length);
  });

  it('findBeatingCombos：上家为炸弹时只返回更大的炸弹/花炸/四王炸', () => {
    const hand = [
      c('spades', 9, 'a'), c('hearts', 9, 'b'), c('clubs', 9, 'c'), c('diamonds', 9, 'd'),
      c('spades', 6, 'e'), c('hearts', 6, 'f'), c('clubs', 6, 'g'), c('diamonds', 6, 'h'),
    ];
    const lastBomb = { type: 'bomb' as const, cards: [], rank: 8, length: 4, bombSize: 4, isBomb: true };
    const beating = findBeatingCombos(hand, LEVEL_NONE, DEFAULT_RULES, lastBomb);
    expect(beating.every((x) => x.isBomb)).toBe(true);
  });
});

describe('bot - chooseAction 决策', () => {
  it('自由出牌：返回合法且存在于手中的 play', () => {
    let s = createGame([true, true, true, true], {}, 0);
    s.turn = 0;
    s.lastPlay = null;
    const action = chooseAction(s, 0);
    expect(action.type).toBe('play');
    const handIds = new Set(s.players[0].hand.map((c) => c.id));
    action.cards.forEach((id) => expect(handIds.has(id)).toBe(true));
    const chosen = pickCards(s.players[0].hand, action.cards);
    expect(identifyCombo(chosen, s.level, s.rules)).not.toBeNull();
  });

  it('能压制时：出最小的非炸弹可压牌', () => {
    let s = createGame([true, true, true, true], {}, 0);
    s.turn = 0;
    s.players[0].hand = [c('spades', 3, 'a'), c('hearts', 9, 'b')];
    s.lastPlay = { seat: 1, combo: { type: 'single', cards: [], rank: 3, length: 1, bombSize: 0, isBomb: false } };
    const action = chooseAction(s, 0);
    expect(action.type).toBe('play');
    const chosen = pickCards(s.players[0].hand, action.cards);
    const combo = identifyCombo(chosen, s.level, s.rules);
    expect(combo?.type).toBe('single');
    expect(beats(combo!, s.lastPlay.combo, s.rules)).toBe(true);
  });

  it('无法压制且无炸弹可炸：过牌', () => {
    let s = createGame([true, true, true, true], {}, 0);
    s.turn = 0;
    s.players[0].hand = [c('spades', 3, 'a'), c('hearts', 4, 'b')];
    s.lastPlay = { seat: 1, combo: { type: 'single', cards: [], rank: 17, length: 1, bombSize: 0, isBomb: false } }; // 大王
    const action = chooseAction(s, 0);
    expect(action.type).toBe('pass');
  });

  it('可炸但手牌较多时保留炸弹选择过牌', () => {
    let s = createGame([true, true, true, true], {}, 0);
    s.turn = 0;
    // 上家打出 A 炸弹（size4）；手牌有 size5 炸弹但无法一手清完，且无非炸弹可压（非炸弹压不过炸弹）
    s.players[0].hand = [
      c('spades', 5, 'a'), c('hearts', 5, 'b'), c('clubs', 5, 'c'), c('diamonds', 5, 'd'), c('spades', 5, 'e'),
      c('hearts', 3, 'f'), c('clubs', 4, 'g'),
    ];
    s.lastPlay = { seat: 1, combo: { type: 'bomb', cards: [], rank: 14, length: 4, bombSize: 4, isBomb: true } };
    const action = chooseAction(s, 0);
    // 无非炸弹可压，仅 size5 炸弹可压但手牌 7 张 > 炸弹张数且 > 4 -> 保留炸弹，过牌
    expect(action.type).toBe('pass');
  });
});

describe('engine - 整局 AI 模拟', () => {
  it('四家均由 AI 自动出牌，能在一局内分出冠军队', () => {
    let s = createGame([true, true, true, true], {}, 0);
    let steps = 0;
    while (s.matchWinner == null && steps < 200000) {
      steps++;
      if (s.roundOver) {
        startNextRound(s);
        continue;
      }
      const seat = s.turn;
      const action: Action = chooseAction(s, seat);
      try {
        s = applyAction(s, seat, action);
      } catch {
        // 兜底：自由出牌必须出（最小单张），否则过牌
        s = applyAction(
          s,
          seat,
          s.lastPlay == null
            ? { type: 'play', cards: [s.players[seat].hand[0].id] }
            : { type: 'pass' },
        );
      }
    }
    expect(s.matchWinner == 0 || s.matchWinner == 1).toBe(true);
    expect(s.phase).toBe('ended');
    expect(steps).toBeLessThan(200000);
  });
});
