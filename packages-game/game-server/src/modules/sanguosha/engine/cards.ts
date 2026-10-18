// 三国杀卡牌定义与牌堆构建（纯函数）

import { SgsCard, CardDefId } from './types';
import { SgsCardType, SgsEquipType, SgsSuit } from '@constants/enums';

interface CardSpec {
  defId: CardDefId;
  name: string;
  type: SgsCardType;
  suit: SgsSuit;
  number: number;
  count: number;
  trickKind?: string;
  equipType?: SgsEquipType;
  attackRange?: number;
  isDelayedTrick?: boolean;
}

// 标准身份局牌堆（简化配比，保证可玩）
const SPECS: CardSpec[] = [
  // 基本牌
  {
    defId: 'sha',
    name: '杀',
    type: SgsCardType.BASIC,
    suit: SgsSuit.SPADE,
    number: 7,
    count: 10,
  },
  {
    defId: 'sha',
    name: '杀',
    type: SgsCardType.BASIC,
    suit: SgsSuit.CLUB,
    number: 7,
    count: 10,
  },
  {
    defId: 'sha',
    name: '杀',
    type: SgsCardType.BASIC,
    suit: SgsSuit.HEART,
    number: 7,
    count: 4,
  },
  {
    defId: 'sha',
    name: '杀',
    type: SgsCardType.BASIC,
    suit: SgsSuit.DIAMOND,
    number: 7,
    count: 4,
  },
  {
    defId: 'shan',
    name: '闪',
    type: SgsCardType.BASIC,
    suit: SgsSuit.HEART,
    number: 2,
    count: 9,
  },
  {
    defId: 'shan',
    name: '闪',
    type: SgsCardType.BASIC,
    suit: SgsSuit.DIAMOND,
    number: 2,
    count: 6,
  },
  {
    defId: 'tao',
    name: '桃',
    type: SgsCardType.BASIC,
    suit: SgsSuit.HEART,
    number: 3,
    count: 6,
  },
  {
    defId: 'tao',
    name: '桃',
    type: SgsCardType.BASIC,
    suit: SgsSuit.DIAMOND,
    number: 3,
    count: 2,
  },

  // 锦囊
  {
    defId: 'jie_dou',
    name: '决斗',
    type: SgsCardType.TRICK,
    suit: SgsSuit.SPADE,
    number: 1,
    count: 2,
    trickKind: 'duel',
  },
  {
    defId: 'nan_man',
    name: '南蛮入侵',
    type: SgsCardType.TRICK,
    suit: SgsSuit.SPADE,
    number: 7,
    count: 1,
    trickKind: 'barbarians',
  },
  {
    defId: 'wan_jian',
    name: '万箭齐发',
    type: SgsCardType.TRICK,
    suit: SgsSuit.HEART,
    number: 1,
    count: 1,
    trickKind: 'archery',
  },
  {
    defId: 'tao_yuan',
    name: '桃园结义',
    type: SgsCardType.TRICK,
    suit: SgsSuit.HEART,
    number: 9,
    count: 1,
    trickKind: 'peace',
  },
  {
    defId: 'wu_zhong',
    name: '无中生有',
    type: SgsCardType.TRICK,
    suit: SgsSuit.HEART,
    number: 7,
    count: 2,
    trickKind: 'draw',
  },
  {
    defId: 'wu_gu',
    name: '五谷丰登',
    type: SgsCardType.TRICK,
    suit: SgsSuit.CLUB,
    number: 3,
    count: 1,
    trickKind: 'harvest',
  },
  {
    defId: 'chai_qiao',
    name: '过河拆桥',
    type: SgsCardType.TRICK,
    suit: SgsSuit.SPADE,
    number: 3,
    count: 3,
    trickKind: 'dismantle',
  },
  {
    defId: 'shun_shou',
    name: '顺手牵羊',
    type: SgsCardType.TRICK,
    suit: SgsSuit.SPADE,
    number: 4,
    count: 3,
    trickKind: 'snatch',
  },
  {
    defId: 'shan_dian',
    name: '闪电',
    type: SgsCardType.TRICK,
    suit: SgsSuit.SPADE,
    number: 12,
    count: 1,
    trickKind: 'lightning',
    isDelayedTrick: true,
  },
  {
    defId: 'le_bu',
    name: '乐不思蜀',
    type: SgsCardType.TRICK,
    suit: SgsSuit.SPADE,
    number: 6,
    count: 2,
    trickKind: 'indulgence',
    isDelayedTrick: true,
  },
  {
    defId: 'bing_liang',
    name: '兵粮寸断',
    type: SgsCardType.TRICK,
    suit: SgsSuit.CLUB,
    number: 4,
    count: 2,
    trickKind: 'supply',
    isDelayedTrick: true,
  },
  {
    defId: 'wu_xie',
    name: '无懈可击',
    type: SgsCardType.TRICK,
    suit: SgsSuit.CLUB,
    number: 11,
    count: 3,
    trickKind: 'dispel',
  },

  // 装备
  {
    defId: 'zhu_ge_crossbow',
    name: '诸葛连弩',
    type: SgsCardType.EQUIPMENT,
    suit: SgsSuit.CLUB,
    number: 1,
    count: 2,
    equipType: SgsEquipType.WEAPON,
    attackRange: 1,
  },
  {
    defId: 'qing_long',
    name: '青釭剑',
    type: SgsCardType.EQUIPMENT,
    suit: SgsSuit.SPADE,
    number: 6,
    count: 1,
    equipType: SgsEquipType.WEAPON,
    attackRange: 2,
  },
  {
    defId: 'gu_dao',
    name: '古锭刀',
    type: SgsCardType.EQUIPMENT,
    suit: SgsSuit.SPADE,
    number: 12,
    count: 1,
    equipType: SgsEquipType.WEAPON,
    attackRange: 2,
  },
  {
    defId: 'ba_gua',
    name: '八卦阵',
    type: SgsCardType.EQUIPMENT,
    suit: SgsSuit.CLUB,
    number: 2,
    count: 2,
    equipType: SgsEquipType.ARMOR,
  },
  {
    defId: 'di_lu',
    name: '的卢',
    type: SgsCardType.EQUIPMENT,
    suit: SgsSuit.CLUB,
    number: 5,
    count: 1,
    equipType: SgsEquipType.HORSE_PLUS,
  },
  {
    defId: 'chi_tu',
    name: '赤兔',
    type: SgsCardType.EQUIPMENT,
    suit: SgsSuit.HEART,
    number: 5,
    count: 1,
    equipType: SgsEquipType.HORSE_MINUS,
  },
];

let counter = 0;

function makeCard(spec: CardSpec, idx: number): SgsCard {
  counter += 1;
  return {
    id: `c${counter}_${spec.defId}_${idx}`,
    defId: spec.defId,
    name: spec.name,
    type: spec.type,
    suit: spec.suit,
    number: spec.number,
    trickKind: spec.trickKind,
    equipType: spec.equipType,
    attackRange: spec.attackRange,
    isDelayedTrick: spec.isDelayedTrick,
  };
}

/** 构建一副完整的牌（不洗牌）；返回 { cards, pile } */
export function buildDeck(): {
  cards: Record<string, SgsCard>;
  pile: string[];
} {
  counter = 0;
  const cards: Record<string, SgsCard> = {};
  const pile: string[] = [];
  for (const spec of SPECS) {
    for (let i = 0; i < spec.count; i++) {
      const c = makeCard(spec, i);
      cards[c.id] = c;
      pile.push(c.id);
    }
  }
  return { cards, pile };
}

/** Fisher–Yates 洗牌（原地） */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 花色是否为红色（红桃/方块） */
export function isRed(suit: SgsSuit): boolean {
  return suit === SgsSuit.HEART || suit === SgsSuit.DIAMOND;
}

/** 花色显示符号 */
export const SUIT_SYMBOL: Record<SgsSuit, string> = {
  [SgsSuit.SPADE]: '♠',
  [SgsSuit.HEART]: '♥',
  [SgsSuit.CLUB]: '♣',
  [SgsSuit.DIAMOND]: '♦',
};
