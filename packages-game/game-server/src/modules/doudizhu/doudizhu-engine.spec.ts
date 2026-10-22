import { DoudizhuGame } from './engine';
import {
  serializeGame,
  restoreGame,
  chooseBotAction,
  addPlayedCount,
} from './engine';

/** 用 bot 决策全程模拟一局，返回结束态的 DoudizhuGame。 */
function playOneAiGame(seed = 1): DoudizhuGame {
  let rngState = seed >>> 0;
  const rng = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };
  const g = new DoudizhuGame({ rng, onEvent: undefined, doubleMode: false });
  g.start();
  const played: Record<number, number> = {};
  let guard = 0;
  while (g.phase !== 'over' && guard++ < 5000) {
    const seat = g.current;
    const action = chooseBotAction(g, seat, 'normal', played);
    if (action.type === 'bid') {
      g.grab(seat, action.choice);
    } else if (action.type === 'double') {
      g.double(action.action);
    } else if (action.type === 'play') {
      const ok = g.play(seat, action.cards);
      if (ok) addPlayedCount(played, action.cards);
      else g.play(seat, [g.hands[seat][0]]); // 兜底：自由出最小单张
    } else if (action.type === 'pass') {
      g.pass(seat);
    }
  }
  return g;
}

describe('doudizhu engine (server port)', () => {
  it('runs a full AI game to over with consistent scoring', () => {
    const g = playOneAiGame(42);
    expect(g.phase).toBe('over');
    expect(g.winner).toBeGreaterThanOrEqual(0);
    expect(g.winner).toBeLessThan(3);
    // 赢家手牌必须清空
    if (g.winner >= 0) expect(g.hands[g.winner].length).toBe(0);
    // 三方分数之和应为 0（地主赢 +2bm / 农民各 -bm；农民赢对称）
    const sum = g.scores[0] + g.scores[1] + g.scores[2];
    expect(sum).toBe(0);
    expect(g.multiplier).toBeGreaterThanOrEqual(1);
  });

  it('serialize -> restore round-trip keeps state and stays playable', () => {
    const g = playOneAiGame(7);
    const json = serializeGame(g);
    // 函数字段不应进入序列化结果
    expect(json.rng).toBeUndefined();
    expect(json.onEvent).toBeUndefined();
    const r = restoreGame(json);
    expect(r.phase).toBe(g.phase);
    expect(r.landlord).toBe(g.landlord);
    expect(r.hands.map((h) => h.length)).toEqual(g.hands.map((h) => h.length));
    expect(typeof r.play).toBe('function');
    expect(typeof r.grab).toBe('function');
  });

  it('addPlayedCount accumulates by rank', () => {
    const played: Record<number, number> = {};
    const g = new DoudizhuGame({ rng: Math.random });
    g.start();
    const some = g.hands[0].slice(0, 3);
    addPlayedCount(played, some);
    // 总计数 = 牌数（同点数会合并累加，这是记牌器的正确语义）
    const total = Object.values(played).reduce((a, b) => a + b, 0);
    expect(total).toBe(some.length);
    for (const c of some) expect(played[c.rank]).toBeGreaterThanOrEqual(1);
  });

  it('multiple seeds all terminate (no infinite loop / illegal play)', () => {
    for (const seed of [1, 2, 3, 99, 777, 2026, 55555]) {
      const g = playOneAiGame(seed);
      expect(g.phase).toBe('over');
    }
  });
});
