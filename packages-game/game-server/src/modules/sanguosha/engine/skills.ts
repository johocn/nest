// 武将定义与技能注册（插件式：id → 技能对象）

import { SgsGameState, SgsHero } from './types';
import { shuffle } from './cards';

/** 技能对象：被动修正 + 可选生命周期钩子（在引擎对应时机调用）。 */
export interface SgsSkill {
  id: string;
  name: string;
  desc: string;
  /** 被动：出杀无次数限制（张飞·咆哮） */
  noShaLimit?: boolean;
  /** 被动：红色手牌可当杀使用（关羽·武圣） */
  redAsSha?: boolean;
  /** 被动：手牌为空时不可被「杀」指定（诸葛亮·空城） */
  emptyCityImmune?: boolean;
  /** 受伤害后钩子（曹操·奸雄：拿走造成伤害的牌；郭嘉·遗计：摸牌） */
  onDamaged?: (state: SgsGameState, seat: number, source: number) => void;
  /** 回合结束钩子（貂蝉·闭月：摸一张） */
  onTurnEnd?: (state: SgsGameState, seat: number) => void;
  /** 准备阶段钩子；返回 true 表示已自行处理摸牌（如张辽·突袭），引擎跳过常规摸牌 */
  onPrepare?: (state: SgsGameState, seat: number) => boolean;
  /** 被动：黑色手牌可当【闪】打出（甄姬·倾国） */
  blackAsShan?: boolean;
}

/** 武将池（标准身份局代表性武将） */
export const HEROES: SgsHero[] = [
  { id: 'liubei', name: '刘备', hp: 4, gender: 'male', skills: ['rende'] },
  { id: 'caocao', name: '曹操', hp: 4, gender: 'male', skills: ['jianxiong'] },
  { id: 'sunquan', name: '孙权', hp: 4, gender: 'male', skills: ['zhibeng'] },
  { id: 'guanyu', name: '关羽', hp: 4, gender: 'male', skills: ['wusheng'] },
  { id: 'zhangfei', name: '张飞', hp: 4, gender: 'male', skills: ['paoxiao'] },
  { id: 'zhugeliang', name: '诸葛亮', hp: 3, gender: 'male', skills: ['kongcheng'] },
  { id: 'huatuo', name: '华佗', hp: 3, gender: 'male', skills: ['qingnang'] },
  { id: 'diaochan', name: '貂蝉', hp: 3, gender: 'female', skills: ['biyue'] },
  { id: 'zhaoyun', name: '赵云', hp: 4, gender: 'male', skills: ['longdan'] },
  { id: 'huangyueying', name: '黄月英', hp: 3, gender: 'female', skills: ['jiqi'] },
  { id: 'zhenji', name: '甄姬', hp: 3, gender: 'female', skills: ['luoshen', 'qingguo'] },
  { id: 'guojia', name: '郭嘉', hp: 3, gender: 'male', skills: ['yiji'] },
  { id: 'zhangliao', name: '张辽', hp: 4, gender: 'male', skills: ['tuxi'] },
  { id: 'lubu', name: '吕布', hp: 4, gender: 'male', skills: ['wushuang'] },
  { id: 'zhouyu', name: '周瑜', hp: 3, gender: 'male', skills: ['yingzi'] },
  { id: 'simayi', name: '司马懿', hp: 3, gender: 'male', skills: ['fankui'] },
  { id: 'machao', name: '马超', hp: 4, gender: 'male', skills: ['mashu'] },
  { id: 'huangzhong', name: '黄忠', hp: 4, gender: 'male', skills: ['liegong'] },
  { id: 'ganning', name: '甘宁', hp: 4, gender: 'male', skills: ['qixi'] },
];

/** 技能注册表 */
export const SKILLS: Record<string, SgsSkill> = {
  rende: {
    id: 'rende',
    name: '仁德',
    desc: '出牌阶段，你可交给其他角色任意张牌（本版简化为被动亮明）。',
  },
  jianxiong: {
    id: 'jianxiong',
    name: '奸雄',
    desc: '当你受到一次伤害后，可获得造成此伤害的牌。',
    onDamaged: (state, seat, source) => {
      // 拿走来源手牌中的一张（简化「拿走伤害牌」）
      const src = state.players[source];
      const me = state.players[seat];
      if (src && src.isAlive && src.hand.length > 0) {
        const id = src.hand.pop();
        if (id) me.hand.push(id);
        state.log.push({ t: state.log.length, type: 'skill', seat, text: '曹操发动【奸雄】，获得一张牌' });
      }
    },
  },
  zhibeng: {
    id: 'zhibeng',
    name: '制衡',
    desc: '出牌阶段，你可弃置任意张牌，然后摸等量的牌。',
  },
  wusheng: {
    id: 'wusheng',
    name: '武圣',
    desc: '你可以将一张红色手牌当【杀】使用。',
    redAsSha: true,
  },
  paoxiao: {
    id: 'paoxiao',
    name: '咆哮',
    desc: '出牌阶段，你使用【杀】没有次数限制。',
    noShaLimit: true,
  },
  kongcheng: {
    id: 'kongcheng',
    name: '空城',
    desc: '当你没有手牌时，你不能成为【杀】或【决斗】的目标。',
    emptyCityImmune: true,
  },
  qingnang: {
    id: 'qingnang',
    name: '青囊',
    desc: '出牌阶段，你可弃置一张手牌，令一名角色回复 1 点体力。',
  },
  biyue: {
    id: 'biyue',
    name: '闭月',
    desc: '结束阶段，你摸一张牌。',
    onTurnEnd: (state, seat) => {
      const me = state.players[seat];
      if (state.drawPile.length === 0 && state.discardPile.length > 0) {
        state.drawPile = shuffle(state.discardPile.splice(0));
      }
      const pid = state.drawPile.pop();
      if (pid) me.hand.push(pid);
      state.log.push({ t: state.log.length, type: 'skill', seat, text: '貂蝉发动【闭月】，摸一张牌' });
    },
  },
  longdan: {
    id: 'longdan',
    name: '龙胆',
    desc: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。',
  },
  jiqi: {
    id: 'jiqi',
    name: '集智',
    desc: '当你使用锦囊牌时，你摸一张牌。',
  },
  luoshen: {
    id: 'luoshen',
    name: '洛神',
    desc: '准备阶段，你可从牌堆顶翻牌，获得所有黑色牌，直到翻到红色牌为止。',
    onPrepare: (state, seat) => {
      const me = state.players[seat];
      let got = 0;
      while (true) {
        if (state.drawPile.length === 0 && state.discardPile.length > 0) {
          state.drawPile = shuffle(state.discardPile.splice(0));
        }
        if (state.drawPile.length === 0) break;
        const id = state.drawPile.pop()!;
        const c = state.cards[id];
        if (c && (c.suit === 'spade' || c.suit === 'club')) {
          me.hand.push(id);
          got++;
        } else {
          state.discardPile.push(id);
          break;
        }
      }
      if (got > 0) {
        state.log.push({ t: state.log.length, type: 'skill', seat, text: `甄姬发动【洛神】，获得 ${got} 张黑色牌` });
      }
      return false;
    },
  },
  qingguo: {
    id: 'qingguo',
    name: '倾国',
    desc: '你可以将一张黑色手牌当【闪】使用或打出。',
    blackAsShan: true,
  },
  yiji: {
    id: 'yiji',
    name: '遗计',
    desc: '当你受到一次伤害后，你摸两张牌。',
    onDamaged: (state, seat) => {
      // 复用轻量摸牌（避免与引擎 drawCards 形成循环依赖，这里内联）
      const me = state.players[seat];
      for (let i = 0; i < 2; i++) {
        if (state.drawPile.length === 0 && state.discardPile.length > 0) {
          state.drawPile = shuffle(state.discardPile.splice(0));
        }
        const pid = state.drawPile.pop();
        if (pid) me.hand.push(pid);
      }
      state.log.push({ t: state.log.length, type: 'skill', seat, text: '郭嘉发动【遗计】，摸两张牌' });
    },
  },
  tuxi: {
    id: 'tuxi',
    name: '突袭',
    desc: '摸牌阶段，你可改为从至多两名其他角色的手牌中各获得一张牌（替代摸牌）。',
    onPrepare: (state, seat) => {
      const me = state.players[seat];
      let stolen = 0;
      for (let i = 1; i <= state.seats && stolen < 2; i++) {
        const s = (seat + i) % state.seats;
        const tgt = state.players[s];
        if (tgt !== me && tgt.isAlive && tgt.hand.length > 0) {
          const id = tgt.hand.pop()!;
          me.hand.push(id);
          stolen++;
          state.log.push({
            t: state.log.length,
            type: 'skill',
            seat,
            text: `张辽发动【突袭】，从 ${getHero(state.players[s].heroId)?.name ?? '座位' + (s + 1)} 获得一张牌`,
          });
        }
      }
      if (stolen > 0) {
        state.log.push({ t: state.log.length, type: 'skill', seat, text: `张辽【突袭】共获得 ${stolen} 张牌` });
      }
      return stolen > 0;
    },
  },
  wushuang: {
    id: 'wushuang',
    name: '无双',
    desc: '你使用的【杀】或【决斗】，对方需连续打出两张【闪】或【杀】才能响应。',
  },
  yingzi: {
    id: 'yingzi',
    name: '英姿',
    desc: '摸牌阶段，你多摸一张牌（共摸三张）。',
    onPrepare: (state, seat) => {
      const me = state.players[seat];
      for (let i = 0; i < 3; i++) {
        if (state.drawPile.length === 0 && state.discardPile.length > 0) {
          state.drawPile = shuffle(state.discardPile.splice(0));
        }
        const pid = state.drawPile.pop();
        if (pid) me.hand.push(pid);
      }
      state.log.push({ t: state.log.length, type: 'skill', seat, text: '周瑜发动【英姿】，摸 3 张牌' });
      return true;
    },
  },
  fankui: {
    id: 'fankui',
    name: '反馈',
    desc: '当你受到伤害后，你可获得伤害来源的一张牌（手牌或装备）。',
    onDamaged: (state, seat, source) => {
      if (source == null || source === seat) return;
      const src = state.players[source];
      if (!src.isAlive) return;
      const pool = [...src.hand];
      if (src.weapon) pool.push(src.weapon);
      if (src.armor) pool.push(src.armor);
      if (pool.length === 0) return;
      const id = pool[Math.floor(Math.random() * pool.length)];
      const idx = src.hand.indexOf(id);
      if (idx !== -1) src.hand.splice(idx, 1);
      else if (src.weapon === id) src.weapon = null;
      else if (src.armor === id) src.armor = null;
      state.players[seat].hand.push(id);
      state.log.push({ t: state.log.length, type: 'skill', seat, text: '司马懿发动【反馈】，获得来源一张牌' });
    },
  },
  mashu: {
    id: 'mashu',
    name: '马术',
    desc: '你计算与其他角色的距离时始终 -1（攻击距离 +1）。',
  },
  liegong: {
    id: 'liegong',
    name: '烈弓',
    desc: '你使用的【杀】无视距离；若目标手牌数小于或等于你的攻击范围，伤害 +1。',
  },
  qixi: {
    id: 'qixi',
    name: '奇袭',
    desc: '出牌阶段，你可弃置一张黑色手牌，当作【过河拆桥】对一名其他角色使用。',
  },
};

export function getHero(id: string | null | undefined): SgsHero | undefined {
  if (!id) return undefined;
  return HEROES.find((h) => h.id === id);
}

export function heroHasSkill(heroId: string | null, skill: string): boolean {
  if (!heroId) return false;
  const h = getHero(heroId);
  return !!h && h.skills.includes(skill);
}

export function getSkill(id: string): SgsSkill | undefined {
  return SKILLS[id];
}
