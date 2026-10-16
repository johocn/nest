import { createGame, playCard, respond, endTurn, damage, startTurn, canAttack, useSkill } from './engine';
import { getHero } from './skills';
import { chooseAction, chooseRespond } from './bot';
import { Identity } from '@constants/enums';
import { SgsGameState } from './types';

function simulate(seats = 8): SgsGameState {
  const isBot = new Array(seats).fill(true);
  let state = createGame(isBot, { seats });
  let guard = 0;
  const validate = (st: SgsGameState, tag: string) => {
    for (const pl of st.players) {
      for (const id of pl.hand) {
        if (!id || !st.cards[id]) {
          const hands = st.players.map((p) => ({ seat: p.seat, h: p.hand, w: p.weapon, j: p.judge }));
          throw new Error(
            `phantom hand id tag=${tag} seat=${pl.seat} ids=${JSON.stringify(pl.hand)} ` +
              `allHands=${JSON.stringify(hands)} ` +
              `logs=${JSON.stringify(st.log.slice(-12))}`,
          );
        }
      }
    }
  };
  validate(state, 'init');
  while (!state.winner && guard++ < 50000) {
    if (state.pendingAsk) {
      const resp = chooseRespond(state, state.pendingAsk.target);
      try {
        state = respond(state, state.pendingAsk.target, resp);
      } catch {
        state = respond(state, state.pendingAsk.target, { type: 'pass' });
      }
      validate(state, `after-respond seat=${state.pendingAsk?.target}`);
      continue;
    }
    if (state.phase === 'play') {
      const cur = state.turn;
      const act = chooseAction(state, cur);
      try {
        if (act.type === 'end_turn') state = endTurn(state, cur);
        else if (act.type === 'play') state = playCard(state, cur, act);
        else if (act.type === 'respond') state = respond(state, cur, act);
        else if (act.type === 'skill')
          state = (require('./engine') as any).useSkill(state, cur, (act as any).skillId, {
            cardIds: (act as any).cardIds,
            target: (act as any).target,
          });
      } catch {
        state = endTurn(state, cur);
      }
      validate(state, `after-play seat=${cur} act=${JSON.stringify(act)}`);
      continue;
    }
    // 兜底推进
    if (state.phase !== 'play') {
      state = endTurn(state, state.turn);
      validate(state, 'after-fallback-endturn');
    }
  }
  return state;
}

describe('Sanguosha engine', () => {
  it('身份分配：8 人局为 1 主公 / 2 忠臣 / 4 反贼 / 1 内奸', () => {
    const isBot = new Array(8).fill(true);
    const s = createGame(isBot, { seats: 8 });
    const counts: Record<string, number> = {};
    for (const p of s.players) counts[p.identity!] = (counts[p.identity!] ?? 0) + 1;
    expect(counts[Identity.LORD]).toBe(1);
    expect(counts[Identity.LOYALIST]).toBe(2);
    expect(counts[Identity.REBEL]).toBe(4);
    expect(counts[Identity.SPY]).toBe(1);
  });

  it('主公座位的血量上限比其他身份 +1', () => {
    const isBot = new Array(8).fill(true);
    const s = createGame(isBot, { seats: 8 });
    const lord = s.players[s.lordSeat];
    const hero = getHero(lord.heroId!)!;
    expect(lord.maxHp).toBe(hero.hp + 1);
  });

  it('发牌：非主公初始手牌=initHand，主公首回合额外摸 2', () => {
    const isBot = new Array(8).fill(true);
    const s = createGame(isBot, { seats: 8, initHand: 4 });
    for (const p of s.players) {
      if (p.seat === s.lordSeat) expect(p.hand.length).toBe(6);
      else expect(p.hand.length).toBe(4);
    }
  });

  it('出杀触发待响应（dodge），响应后结算', () => {
    // 构造：座 0 对座 1 出杀
    const isBot = new Array(8).fill(true);
    const s0 = createGame(isBot, { seats: 8 });
    s0.turn = 0;
    s0.phase = 'play' as any;
    s0.pendingAsk = null;
    // 强制给 0 一张杀、给 1 一张闪
    const shaId = 'test_sha';
    const shanId = 'test_shan';
    (s0.cards as any)[shaId] = { id: shaId, defId: 'sha', name: '杀', type: 'basic', suit: 'spade', number: 7 };
    (s0.cards as any)[shanId] = { id: shanId, defId: 'shan', name: '闪', type: 'basic', suit: 'heart', number: 2 };
    s0.players[0].hand.push(shaId);
    s0.players[1].hand.push(shanId);
    const hpBefore = s0.players[1].hp;
    const s1 = playCard(s0, 0, { type: 'play', cardIds: [shaId], target: 1 });
    expect(s1.pendingAsk?.kind).toBe('dodge');
    const s2 = respond(s1, 1, { type: 'respond', dodge: true });
    expect(s2.pendingAsk).toBeNull();
    expect(s2.players[1].hp).toBe(hpBefore); // 出闪无伤
  });

  it('乐不思蜀可被无懈可击抵消（响应链）', () => {
    const isBot = new Array(8).fill(true);
    const s0 = createGame(isBot, { seats: 8 });
    s0.turn = 0;
    s0.phase = 'play' as any;
    s0.pendingAsk = null;
    const lebuId = 'test_lebu';
    const wx1 = 'test_wx1';
    (s0.cards as any)[lebuId] = {
      id: lebuId,
      defId: 'le_bu',
      name: '乐不思蜀',
      type: 'trick',
      suit: 'spade',
      number: 6,
      trickKind: 'indulgence',
      isDelayedTrick: true,
    };
    (s0.cards as any)[wx1] = {
      id: wx1,
      defId: 'wu_xie',
      name: '无懈可击',
      type: 'trick',
      suit: 'club',
      number: 11,
      trickKind: 'dispel',
    };
    s0.players[0].hand.push(lebuId);
    s0.players[1].hand.push(wx1);

    const s1 = playCard(s0, 0, { type: 'play', cardIds: [lebuId], target: 1 });
    expect(s1.pendingAsk?.kind).toBe('wuxie');

    // 依次响应：仅 seat1 打出无懈（其余见已抵消不再无懈，避免帮倒忙），直到链结束
    let s: typeof s1 = s1;
    while (s.pendingAsk) {
      const t = s.pendingAsk.target;
      s = respond(s, t, { type: 'respond', wuxie: t === 1 });
    }
    expect(s.pendingAsk).toBeNull();
    // 无懈生效：乐不思蜀未进入 seat1 判定区
    expect(s.players[1].judge.length).toBe(0);
  });

  it('郭嘉·遗计：受伤后摸两张', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'guojia';
    s0.players[0].hand = [];
    damage(s0, 0, 1, 1); // damage 直接改 state，无返回值
    expect(s0.players[0].hand.length).toBe(2);
  });

  it('甄姬·洛神：准备阶段翻黑牌入摸', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'zhenji';
    s0.players[0].hand = [];
    s0.drawPile = ['lk1', 'lk2', 'lk3'];
    (s0.cards as any)['lk1'] = { id: 'lk1', defId: 'sha', name: '杀', type: 'basic', suit: 'spade', number: 5 };
    (s0.cards as any)['lk2'] = { id: 'lk2', defId: 'sha', name: '杀', type: 'basic', suit: 'club', number: 6 };
    (s0.cards as any)['lk3'] = { id: 'lk3', defId: 'tao', name: '桃', type: 'basic', suit: 'heart', number: 3 };
    startTurn(s0, 0); // 直接改 state，无返回值
    const blacks = s0.players[0].hand.filter((id) => {
      const c = (s0.cards as any)[id];
      return c && (c.suit === 'spade' || c.suit === 'club');
    });
    expect(blacks.length).toBeGreaterThanOrEqual(2);
  });

  it('甄姬·倾国：黑色手牌可当闪响应', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[1].heroId = 'zhenji';
    s0.players[1].hand = ['bk1'];
    (s0.cards as any)['bk1'] = { id: 'bk1', defId: 'sha', name: '杀', type: 'basic', suit: 'spade', number: 5 };
    s0.pendingAsk = { kind: 'dodge', source: 0, target: 1, desc: '出闪' } as any;
    const hpBefore = s0.players[1].hp;
    const s1 = respond(s0, 1, { type: 'respond', dodge: true });
    expect(s1.pendingAsk).toBeNull();
    expect(s1.players[1].hand.length).toBe(0); // 黑杀被当闪打出
    expect(s1.players[1].hp).toBe(hpBefore); // 未受伤
  });

  it('吕布·无双：杀需两张闪，仅1张闪则受伤', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'lubu';
    s0.players[0].hand = ['shaFake'];
    (s0.cards as any)['shaFake'] = { id: 'shaFake', defId: 'sha', name: '杀', type: 'basic', suit: 'spade', number: 5 };
    s0.players[1].hand = ['sh1'];
    (s0.cards as any)['sh1'] = { id: 'sh1', defId: 'shan', name: '闪', type: 'basic', suit: 'heart', number: 2 };
    s0.pendingAsk = null;
    const s1 = playCard(s0, 0, { type: 'play', cardIds: ['shaFake'], target: 1 });
    expect((s1.pendingAsk as any)?.wushuang).toBe(true);
    const hpBefore = s1.players[1].hp;
    const s2 = respond(s1, 1, { type: 'respond', dodge: true });
    expect(s2.pendingAsk).toBeNull();
    expect(s2.players[1].hp).toBe(hpBefore - 1); // 1张闪不足，受伤
  });

  it('吕布·无双：目标有两张闪可成功响应', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'lubu';
    s0.players[0].hand = ['shaFake'];
    (s0.cards as any)['shaFake'] = { id: 'shaFake', defId: 'sha', name: '杀', type: 'basic', suit: 'spade', number: 5 };
    s0.players[1].hand = ['sh1', 'sh2'];
    (s0.cards as any)['sh1'] = { id: 'sh1', defId: 'shan', name: '闪', type: 'basic', suit: 'heart', number: 2 };
    (s0.cards as any)['sh2'] = { id: 'sh2', defId: 'shan', name: '闪', type: 'basic', suit: 'heart', number: 3 };
    s0.pendingAsk = null;
    const s1 = playCard(s0, 0, { type: 'play', cardIds: ['shaFake'], target: 1 });
    const hpBefore = s1.players[1].hp;
    const s2 = respond(s1, 1, { type: 'respond', dodge: true });
    expect(s2.players[1].hp).toBe(hpBefore); // 未受伤
    expect(s2.players[1].hand.length).toBe(0); // 两张闪被打出
  });

  it('周瑜·英姿：摸牌阶段摸三张', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'zhouyu';
    s0.players[0].hand = [];
    startTurn(s0, 0);
    expect(s0.players[0].hand.length).toBe(3);
  });

  it('司马懿·反馈：受伤后获得来源一张牌', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'simayi';
    s0.players[1].hand = ['x1'];
    (s0.cards as any)['x1'] = { id: 'x1', defId: 'sha', name: '杀', type: 'basic', suit: 'spade', number: 5 };
    const h0Before = s0.players[0].hand.length;
    const h1Before = s0.players[1].hand.length;
    damage(s0, 0, 1, 1);
    expect(s0.players[0].hand.length).toBe(h0Before + 1);
    expect(s0.players[1].hand.length).toBe(h1Before - 1);
  });

  it('马超·马术：攻击距离 +1', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'machao';
    // 无马术时距离2不可杀；马术下可杀
    expect(canAttack(s0, 0, 2)).toBe(true);
    s0.players[0].heroId = 'liubei';
    expect(canAttack(s0, 0, 2)).toBe(false);
  });

  it('黄忠·烈弓：杀无视距离', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'huangzhong';
    expect(canAttack(s0, 0, 3)).toBe(true); // 距离3本不可达，烈弓无视
  });

  it('黄忠·烈弓：目标手牌≤攻距时伤害+1', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'huangzhong';
    s0.players[0].hand = ['shaFake'];
    (s0.cards as any)['shaFake'] = { id: 'shaFake', defId: 'sha', name: '杀', type: 'basic', suit: 'spade', number: 5 };
    s0.players[1].heroId = 'machao';
    s0.players[1].hand = []; // 手牌0 ≤ 攻距1 → 伤害+1
    s0.pendingAsk = null;
    const s1 = playCard(s0, 0, { type: 'play', cardIds: ['shaFake'], target: 1 });
    const hpBefore = s1.players[1].hp;
    const s2 = respond(s1, 1, { type: 'respond', dodge: false });
    expect(s2.players[1].hp).toBe(hpBefore - 2); // 烈弓 +1
  });

  it('甘宁·奇袭：弃黑色手牌当过河拆桥', () => {
    const s0 = createGame(new Array(8).fill(true), { seats: 8 });
    s0.players[0].heroId = 'ganning';
    s0.players[0].hand = ['bk', 'rd'];
    (s0.cards as any)['bk'] = { id: 'bk', defId: 'sha', name: '杀', type: 'basic', suit: 'spade', number: 5 };
    (s0.cards as any)['rd'] = { id: 'rd', defId: 'sha', name: '杀', type: 'basic', suit: 'heart', number: 6 };
    s0.players[1].hand = ['v1'];
    (s0.cards as any)['v1'] = { id: 'v1', defId: 'shan', name: '闪', type: 'basic', suit: 'heart', number: 2 };
    s0.turn = 0;
    s0.phase = 'play' as any;
    const targetTotalBefore =
      s0.players[1].hand.length +
      [s0.players[1].weapon, s0.players[1].armor, s0.players[1].horsePlus, s0.players[1].horseMinus].filter(Boolean).length;
    const s1 = useSkill(s0, 0, 'qixi', { cardIds: ['bk'], target: 1 });
    expect(s1.players[0].hand).not.toContain('bk');
    expect(s1.discardPile).toContain('bk');
    const targetTotalAfter =
      s1.players[1].hand.length +
      [s1.players[1].weapon, s1.players[1].armor, s1.players[1].horsePlus, s1.players[1].horseMinus].filter(Boolean).length;
    expect(targetTotalAfter).toBe(targetTotalBefore - 1);
  });

  it('完整 AI 对局能在有限步内产生胜方', () => {
    const final = simulate(8);
    expect(final.winner).not.toBeNull();
    expect(['lord', 'loyalist', 'rebel', 'spy']).toContain(final.winner);
  });
});
