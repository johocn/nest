import { Card, Suit, JokerType, Combo, Rules, DEFAULT_RULES } from './types';
import { identifyCombo, beats } from './combos';

// 99 表示"非任意真实级牌"，确保测试牌不会被当作百搭
const LV_NONE = 99;
// 15 = '2'，配合红桃 15 触发百搭
const LV_TWO = 15;

function c(suit: Suit, rank: number, id?: string): Card {
  return { id: id ?? `${suit}-${rank}`, suit, rank };
}
function j(type: JokerType, id?: string): Card {
  return { id: id ?? `joker-${type}-${id ?? ''}`, suit: 'joker', rank: type === 'big' ? 17 : 16, joker: type };
}

function idOf(cards: Card[]): string[] {
  return cards.map((x) => x.id);
}

describe('identifyCombo - 基础牌型', () => {
  it('单张', () => {
    const combo = identifyCombo([c('spades', 3)], LV_NONE, DEFAULT_RULES);
    expect(combo?.type).toBe('single');
    expect(combo?.rank).toBe(3);
    expect(combo?.isBomb).toBe(false);
  });

  it('对子', () => {
    const combo = identifyCombo([c('spades', 3), c('hearts', 3)], LV_NONE, DEFAULT_RULES);
    expect(combo?.type).toBe('pair');
    expect(combo?.rank).toBe(3);
  });

  it('三张', () => {
    const combo = identifyCombo([c('spades', 7), c('hearts', 7), c('clubs', 7)], LV_NONE, DEFAULT_RULES);
    expect(combo?.type).toBe('triple');
    expect(combo?.rank).toBe(7);
  });

  it('三带二', () => {
    const combo = identifyCombo(
      [c('spades', 7), c('hearts', 7), c('clubs', 7), c('spades', 3), c('hearts', 3)],
      LV_NONE,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('triple_pair');
    expect(combo?.rank).toBe(7);
  });

  it('顺子（≥5 连单，顶张为 rank）', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 4), c('clubs', 5), c('diamonds', 6), c('spades', 7)],
      LV_NONE,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('straight');
    expect(combo?.rank).toBe(7);
    expect(combo?.length).toBe(5);
  });

  it('连对（≥3 连对）', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 3), c('clubs', 4), c('diamonds', 4), c('spades', 5), c('hearts', 5)],
      LV_NONE,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('double_straight');
    expect(combo?.rank).toBe(5);
    expect(combo?.length).toBe(3);
  });

  it('钢板（≥2 连三）', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 3), c('clubs', 3), c('spades', 4), c('hearts', 4), c('clubs', 4)],
      LV_NONE,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('triple_straight');
    expect(combo?.rank).toBe(4);
    expect(combo?.length).toBe(2);
  });

  it('炸弹（4 张同点）', () => {
    const combo = identifyCombo(
      [c('spades', 9), c('hearts', 9), c('clubs', 9), c('diamonds', 9)],
      LV_NONE,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('bomb');
    expect(combo?.rank).toBe(9);
    expect(combo?.bombSize).toBe(4);
    expect(combo?.isBomb).toBe(true);
  });

  it('同花顺（花炸）', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('spades', 4), c('spades', 5), c('spades', 6), c('spades', 7)],
      LV_NONE,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('straight_flush');
    expect(combo?.isBomb).toBe(true);
    expect(combo?.rank).toBe(7);
    expect(combo?.length).toBe(5);
  });

  it('四带二（单）', () => {
    const combo = identifyCombo(
      [c('spades', 9), c('hearts', 9), c('clubs', 9), c('diamonds', 9), c('spades', 3), c('hearts', 5)],
      LV_NONE,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('four_two');
    expect(combo?.rank).toBe(9);
  });

  it('四带两对', () => {
    const combo = identifyCombo(
      [
        c('spades', 9), c('hearts', 9), c('clubs', 9), c('diamonds', 9),
        c('spades', 3), c('hearts', 3), c('spades', 5), c('hearts', 5),
      ],
      LV_NONE,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('four_two_pair');
    expect(combo?.rank).toBe(9);
  });

  it('四王炸', () => {
    const combo = identifyCombo([j('big', '1'), j('big', '2'), j('small', '1'), j('small', '2')], LV_NONE, DEFAULT_RULES);
    expect(combo?.type).toBe('king_bomb');
    expect(combo?.isBomb).toBe(true);
    expect(combo?.bombSize).toBe(4);
  });

  it('非法：两张不同单牌不是对子', () => {
    expect(identifyCombo([c('spades', 3), c('hearts', 4)], LV_NONE, DEFAULT_RULES)).toBeNull();
  });

  it('非法：4 张不同牌不是炸弹', () => {
    expect(
      identifyCombo([c('spades', 3), c('hearts', 4), c('clubs', 5), c('diamonds', 6)], LV_NONE, DEFAULT_RULES),
    ).toBeNull();
  });

  it('非法：王不可与其它牌组合', () => {
    expect(identifyCombo([j('big', '1'), c('spades', 3)], LV_NONE, DEFAULT_RULES)).toBeNull();
  });
});

describe('identifyCombo - 逢人配（百搭补位）', () => {
  it('单张百搭：点数为 level', () => {
    const combo = identifyCombo([c('hearts', 15)], LV_TWO, DEFAULT_RULES);
    expect(combo?.type).toBe('single');
    expect(combo?.rank).toBe(15);
  });

  it('对子：一张自然牌 + 一张百搭', () => {
    const combo = identifyCombo([c('spades', 5), c('hearts', 15)], LV_TWO, DEFAULT_RULES);
    expect(combo?.type).toBe('pair');
    expect(combo?.rank).toBe(5);
  });

  it('三张：两张自然 + 一张百搭', () => {
    const combo = identifyCombo([c('spades', 5), c('hearts', 5), c('hearts', 15)], LV_TWO, DEFAULT_RULES);
    expect(combo?.type).toBe('triple');
    expect(combo?.rank).toBe(5);
  });

  it('级牌补位形成更大炸弹：三张 9 + 一张百搭 = 四炸', () => {
    const combo = identifyCombo(
      [c('spades', 9), c('hearts', 9), c('clubs', 9), c('hearts', 15)],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('bomb');
    expect(combo?.rank).toBe(9);
    expect(combo?.bombSize).toBe(4);
  });

  it('顺子可用百搭补位（缺一张）', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('spades', 4), c('spades', 5), c('spades', 6), c('hearts', 15)],
      LV_TWO,
      DEFAULT_RULES,
    );
    // 红桃15 既是百搭又是同花色，可补成 3-7 同花顺
    expect(combo?.type).toBe('straight_flush');
    expect(combo?.rank).toBe(7);
  });
});

describe('identifyCombo - 逢人配（百搭补位）扩展', () => {
  it('连对：缺一张用百搭补成一对', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 3), c('spades', 4), c('hearts', 4), c('spades', 5), c('hearts', 15)],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('double_straight');
    expect(combo?.rank).toBe(5);
    expect(combo?.length).toBe(3); // 33 44 55
  });

  it('钢板：缺一张用百搭补成连续三张', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 3), c('clubs', 3), c('spades', 4), c('hearts', 4), c('hearts', 15)],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('triple_straight');
    expect(combo?.rank).toBe(4);
    expect(combo?.length).toBe(2); // 333 444
  });

  it('三带二：百搭补成二（与三张不同点）', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 3), c('clubs', 3), c('spades', 5), c('hearts', 15)],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('triple_pair');
    expect(combo?.rank).toBe(3); // 333 + 55（百搭作 5）
  });

  it('四带二（单）：百搭补成一张单牌', () => {
    const combo = identifyCombo(
      [c('spades', 9), c('hearts', 9), c('clubs', 9), c('diamonds', 9), c('spades', 3), c('hearts', 15)],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('four_two');
    expect(combo?.rank).toBe(9); // 9999 + 3 + 百搭
  });

  it('四带两对：百搭补成第二对', () => {
    const combo = identifyCombo(
      [
        c('spades', 9), c('hearts', 9), c('clubs', 9), c('diamonds', 9),
        c('spades', 3), c('hearts', 3), c('spades', 5), c('hearts', 15),
      ],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('four_two_pair');
    expect(combo?.rank).toBe(9); // 9999 + 33 + 55（百搭作 5）
  });

  it('两张百搭 + 两张同点 = 四张炸弹', () => {
    const combo = identifyCombo(
      [c('spades', 9), c('hearts', 9), c('hearts', 15), c('hearts', 15, 'w2')],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('bomb');
    expect(combo?.rank).toBe(9);
    expect(combo?.bombSize).toBe(4);
  });

  it('百搭补普通顺子（非同花，忽略花色）', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 4), c('clubs', 5), c('diamonds', 6), c('hearts', 15)],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('straight'); // 3-7，花色混合仍可作普通顺子
    expect(combo?.rank).toBe(7);
  });

  it('混合花色 + 百搭不能识别为同花顺（应退化为普通顺子/其它）', () => {
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 4), c('spades', 5), c('diamonds', 6), c('hearts', 15)],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo?.type).toBe('straight'); // 非全同花，不会是 straight_flush
  });

  it('负向：两张百搭 + 两张不同点牌不是合法牌型', () => {
    const combo = identifyCombo(
      [c('spades', 5), c('spades', 7), c('hearts', 15), c('hearts', 15, 'w2')],
      LV_TWO,
      DEFAULT_RULES,
    );
    expect(combo).toBeNull();
  });

  it('负向：百搭无法补跨越级牌的顺子（级牌在 3-14 之间）', () => {
    // level=5（红桃5 作百搭），3 4 6 7 + 红桃5：唯一窗口 3-7 含级牌 5，应失败
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 4), c('clubs', 6), c('diamonds', 7), c('hearts', 5)],
      5,
      DEFAULT_RULES,
    );
    expect(combo).toBeNull();
  });

  it('负向：三带二缺两张且百搭不足以补成对', () => {
    // 333 + 单 5 + 单 7（无百搭）：不是三带二
    const combo = identifyCombo(
      [c('spades', 3), c('hearts', 3), c('clubs', 3), c('spades', 5), c('spades', 7)],
      LV_NONE,
      DEFAULT_RULES,
    );
    expect(combo).toBeNull();
  });
});

describe('beats - 大小比较', () => {
  const rules: Rules = DEFAULT_RULES;

  function bomb(rank: number, size: number): Combo {
    return { type: 'bomb', cards: [], rank, length: size, bombSize: size, isBomb: true };
  }
  function straight(top: number, len: number): Combo {
    return { type: 'straight', cards: [], rank: top, length: len, bombSize: 0, isBomb: false };
  }
  function pair(rank: number): Combo {
    return { type: 'pair', cards: [], rank, length: 2, bombSize: 0, isBomb: false };
  }
  function sf(top: number, len: number): Combo {
    return { type: 'straight_flush', cards: [], rank: top, length: len, bombSize: 0, isBomb: true };
  }
  function kingBomb(): Combo {
    return { type: 'king_bomb', cards: [], rank: 17, length: 4, bombSize: 4, isBomb: true };
  }

  it('炸弹压非炸弹', () => {
    expect(beats(bomb(9, 4), straight(14, 5), rules)).toBe(true);
    expect(beats(bomb(9, 4), pair(14), rules)).toBe(true);
  });

  it('非炸弹压不过炸弹', () => {
    expect(beats(straight(14, 5), bomb(9, 4), rules)).toBe(false);
  });

  it('同型非炸弹：同长比顶张，不同长不可压', () => {
    expect(beats(straight(8, 5), straight(7, 5), rules)).toBe(true);
    expect(beats(straight(7, 5), straight(8, 5), rules)).toBe(false);
    expect(beats(straight(8, 6), straight(14, 5), rules)).toBe(false);
    expect(beats(pair(5), pair(5), rules)).toBe(false);
  });

  it('普通炸弹：张数多者大，同张数比点数', () => {
    expect(beats(bomb(9, 5), bomb(9, 4), rules)).toBe(true);
    expect(beats(bomb(9, 4), bomb(10, 4), rules)).toBe(false);
    expect(beats(bomb(10, 4), bomb(9, 4), rules)).toBe(true);
    expect(beats(bomb(9, 4), bomb(9, 4), rules)).toBe(false);
  });

  it('四王炸最大，普通炸弹压不过', () => {
    expect(beats(kingBomb(), bomb(9, 4), rules)).toBe(true);
    expect(beats(kingBomb(), bomb(9, 8), rules)).toBe(true);
    expect(beats(bomb(9, 8), kingBomb(), rules)).toBe(false);
  });

  it('同花顺（花炸）默认大于普通炸弹', () => {
    expect(beats(sf(7, 5), bomb(9, 4), rules)).toBe(true);
    expect(beats(sf(14, 6), bomb(2, 8), rules)).toBe(true);
  });

  it('普通炸弹压不过同花顺', () => {
    expect(beats(bomb(9, 4), sf(7, 5), rules)).toBe(false);
  });

  it('同花顺不能压非炸弹/非花炸', () => {
    expect(beats(sf(7, 5), straight(14, 5), rules)).toBe(false);
    expect(beats(sf(7, 5), pair(14), rules)).toBe(false);
  });

  it('同花顺之间比长度再比顶张', () => {
    expect(beats(sf(8, 6), sf(7, 5), rules)).toBe(true);
    expect(beats(sf(7, 5), sf(8, 6), rules)).toBe(false);
    expect(beats(sf(8, 5), sf(7, 5), rules)).toBe(true);
  });

  it('规则开关：sixBombOverKingBomb 时 6+ 炸弹可压四王炸', () => {
    const r2: Rules = { ...rules, sixBombOverKingBomb: true };
    expect(beats(bomb(9, 6), kingBomb(), r2)).toBe(true);
    expect(beats(bomb(9, 4), kingBomb(), r2)).toBe(false);
  });

  it('规则开关：straightFlushOverBomb=false 时花炸不压普通炸弹', () => {
    const r2: Rules = { ...rules, straightFlushOverBomb: false };
    expect(beats(sf(7, 5), bomb(9, 4), r2)).toBe(false);
  });
});
