/** 沙盘游戏核心配置 */
export const GameConfig = {
  /** 每个交易日切片数 */
  SLICES_PER_DAY: 52,
  /** 切片实时时长（毫秒，@1x；5x 时约 80ms） */
  SLICE_DURATION_MS: 400,
  /** 每个切片对应的模拟交易分钟数 */
  SIM_MINUTES_PER_SLICE: 5,
  /** 一局回放的自然日天数（约一个季度，走完自动结算） */
  PLAY_DAYS: 60,
  /** 数据起始日期 */
  DATA_START: '2022-01-01',
  /** 数据结束日期 */
  DATA_END: '2026-07-01',
  /** 初始本金 */
  INITIAL_PRINCIPAL: 100000,
  /** 存款利率（年化） */
  DEPOSIT_RATE: 0.0175,
  /** 封闭式理财期限（交易日） */
  CLOSED_FUND_TERM_DAYS: 90,
  /** 封闭式理财年化收益率 */
  CLOSED_FUND_RATE: 0.038,
  /** 现金理财年化收益率 */
  CASH_MGMT_RATE: 0.025,
  /** 风险提示文字 */
  RISK_DISCLAIMER:
    '本沙盘仅财商教育演示，历史回放数据不等于未来收益，不构成投资建议。',
  /** 后端API地址 */
  API_BASE: '/api/sandbox/v1',
  /** 默认随机种子（行情可复现，`?seed=` 覆盖） */
  DEFAULT_SEED: 20260101,
  /** 休市日停留时长（毫秒，按速度倍率缩放） */
  HOLIDAY_SKIP_MS: 800,
  /** 速度倍率上下限 */
  MIN_SPEED: 0.5,
  MAX_SPEED: 10,
} as const;

/** 游戏难度（影响任务卡阈值与点评基调） */
export type GameLevel = 'conservative' | 'balanced' | 'aggressive';

/** 难度对应的任务卡阈值 */
export interface LevelCaps {
  /** 基金市值占比上限 */
  equityCap: number;
  /** 现金 + 现金理财占比下限 */
  liquidityFloor: number;
  /** 稳健增值目标收益率 */
  profitTarget: number;
  /** 守住回撤目标（上限） */
  drawdownCap: number;
}

/** 三档难度档位定义 */
export const LEVELS: Record<
  GameLevel,
  { name: string; desc: string; caps: LevelCaps }
> = {
  conservative: {
    name: '保守型',
    desc: '控波动优先：低仓位、留足流动性',
    caps: {
      equityCap: 0.35,
      liquidityFloor: 0.3,
      profitTarget: 0.02,
      drawdownCap: 0.05,
    },
  },
  balanced: {
    name: '稳健型',
    desc: '攻守平衡（推荐多数人）',
    caps: {
      equityCap: 0.4,
      liquidityFloor: 0.25,
      profitTarget: 0.03,
      drawdownCap: 0.08,
    },
  },
  aggressive: {
    name: '进取型',
    desc: '收益优先：能扛波动、目标更高',
    caps: {
      equityCap: 0.5,
      liquidityFloor: 0.15,
      profitTarget: 0.05,
      drawdownCap: 0.12,
    },
  },
};

/** 默认难度 */
export const DEFAULT_LEVEL: GameLevel = 'balanced';

/** 行情情景（回放起点与时长预设） */
export interface ScenarioDef {
  id: string;
  name: string;
  /** 回放起始日期（YYYY-MM-DD） */
  start: string;
  /** 本局自然日天数上限 */
  days: number;
  desc: string;
  /** 财商科普：这段行情的历史背景与演练要点 */
  note: string;
}

/** 情景预设：不同起点/时长带来不同演练体验 */
export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'standard',
    name: '标准',
    start: '2022-01-01',
    days: 60,
    desc: '60 个自然日，走完自动结算',
    note: '模拟一段常见的震荡行情，适合先熟悉买卖、定投与资产配置的基本操作。',
  },
  {
    id: 'long',
    name: '加长',
    start: '2022-01-01',
    days: 120,
    desc: '120 个自然日，体验更长周期与复利',
    note: '更长周期（120 天）的行情回放，体会复利累积与市场波动如何共同影响最终收益。',
  },
  {
    id: 'mid',
    name: '中途',
    start: '2023-06-01',
    days: 60,
    desc: '从 2023 年年中开始回放',
    note: '复盘 2023 年下半年的震荡偏弱行情，练习在偏弱市场里控制权益仓位、保留流动性。',
  },
  {
    id: 'recent',
    name: '近期',
    start: '2025-06-01',
    days: 60,
    desc: '从 2025 年年中开始，临近数据末尾',
    note: '复盘 2025 年下半年的市场回暖，练习在上涨行情中避免追高、守住回撤。',
  },
];

/** 默认情景 id */
export const DEFAULT_SCENARIO = 'standard';

/** 定投计划（定期定额，传授“定投平滑波动”） */
export interface DcaPlan {
  enabled: boolean;
  asset: AssetType;
  /** 每期金额 */
  amount: number;
  /** 间隔（交易日） */
  intervalDays: number;
}

/** 默认定投计划（关闭；基金 ¥2,000 / 每 5 个交易日） */
export const DEFAULT_DCA: DcaPlan = {
  enabled: false,
  asset: 'fund',
  amount: 2000,
  intervalDays: 5,
};

/** 资产百科：风险 / 收益 / 流动性科普（财商教育） */
export interface AssetGuide {
  name: string;
  risk: '低' | '中低' | '中' | '高';
  returnLevel: '低' | '中低' | '中' | '高';
  liquidity: '高' | '中' | '低';
  summary: string;
  points: string[];
}

/** 四类资产的知识卡内容 */
export const ASSET_GUIDE: Record<AssetType, AssetGuide> = {
  deposit: {
    name: '存款',
    risk: '低',
    returnLevel: '低',
    liquidity: '高',
    summary: '把钱存在银行赚固定利息，本金风险极低，是资产配置的“安全垫”。',
    points: [
      '收益稳定但偏低，长期看难跑赢通胀',
      '活期随取随用，定期提前支取会损失利息',
      '适合放应急金与短期确定要用的钱',
    ],
  },
  cash_mgmt: {
    name: '现金理财',
    risk: '中低',
    returnLevel: '中低',
    liquidity: '高',
    summary: '货币基金类产品，投短期票据，赎回到账快，常被用来替代活期。',
    points: [
      '收益通常比活期存款略高，仍属低风险',
      '多数支持快速赎回，兼顾收益与灵活',
      '极端市场下也可能出现短暂小幅亏损',
    ],
  },
  closed_fund: {
    name: '封闭理财',
    risk: '中',
    returnLevel: '中',
    liquidity: '低',
    summary: '约定封闭期的理财产品，用“这段时间不能动”换取更高一点的收益。',
    points: [
      '封闭期内无法赎回，急用钱取不出来',
      '到期自动兑付到现金，省心但缺灵活',
      '适合长期用不到的闲钱',
    ],
  },
  fund: {
    name: '基金',
    risk: '高',
    returnLevel: '高',
    liquidity: '高',
    summary: '一篮子股票/债券的组合，随市场涨跌，波动与潜在收益都更大。',
    points: [
      '收益高但回撤也大，需要能长期持有',
      '已分散个股风险，但仍整体受市场影响',
      '适合用定投分批买入，平滑成本与波动',
    ],
  },
};

/** 按 id 取情景，未知 id 回落默认。standard 的天数动态跟随 PLAY_DAYS（便于课堂/测试调节标准局长度） */
export function resolveScenario(id: string): ScenarioDef {
  const def = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  return def.id === 'standard' ? { ...def, days: GameConfig.PLAY_DAYS } : def;
}

/** 资产净值曲线采样点 */
export interface EquityPoint {
  date: string;
  /** 当日总资产 */
  total: number;
  /** 当日基金净值 */
  fundNav: number;
}

/** 分资产每日市值采样点（用于资产面板迷你曲线） */
export interface AssetHistoryPoint {
  date: string;
  cash: number;
  deposit: number;
  cashMgmt: number;
  closedFund: number;
  fund: number;
}

/** 单资产收益归因（已实现 + 浮动盈亏） */
export interface AssetAttribution {
  type: AssetType;
  name: string;
  /** 累计投入 */
  invested: number;
  /** 累计赎回/兑付回流 */
  redeemed: number;
  /** 期末市值 */
  currentValue: number;
  /** 贡献 = 期末市值 + 回流 - 投入 */
  contribution: number;
}

/** 结算成绩单 */
export interface GameSummary {
  /** 难度档位 */
  level: GameLevel;
  /** 行情情景 */
  scenario: { id: string; name: string };
  /** 起始日期 */
  startDate: string;
  /** 结束日期 */
  endDate: string;
  /** 经历自然日 */
  days: number;
  /** 期初本金 */
  principal: number;
  /** 期末总资产 */
  totalAssets: number;
  /** 总收益 */
  totalReturn: number;
  /** 总收益率 */
  totalReturnRate: number;
  /** 年化收益率（按 365 天折算） */
  annualizedReturn: number;
  /** 最大回撤（正数，0.12 = 回撤 12%） */
  maxDrawdown: number;
  /** 各资产收益明细 */
  holdings: AssetHolding[];
  /** 操作次数 */
  tradeCount: number;
  /** 定投扣款次数 */
  dcaCount: number;
  /** 教学目标达成情况 */
  missions: { completed: number; total: number };
  /** 收益归因（按资产） */
  attribution: AssetAttribution[];
  /** 关键操作时间线（最近若干条） */
  timeline: {
    date: string;
    action: string;
    amount: number;
    description: string;
  }[];
  /** 综合评级 */
  rating: string;
  /** 评级说明 */
  ratingReason: string;
  /** 市场环境点评（基于回撤/收益生成的教学建议） */
  environment: { label: string; advice: string };
}

export type SliceStatus = 'pending' | 'running' | 'suspended' | 'completed';

export interface SliceInfo {
  index: number;
  status: SliceStatus;
  /** 切片对应的真实时间戳 */
  timestamp: number;
  /** 是否被临时停牌 */
  isSuspended: boolean;
}

export type TradingPhase =
  | 'idle'
  | 'pre_open'
  | 'trading'
  | 'suspended'
  | 'forced_close'
  | 'holiday'
  | 'settlement';

export type AssetType = 'deposit' | 'cash_mgmt' | 'closed_fund' | 'fund';

export interface AssetHolding {
  type: AssetType;
  /** 投入本金 */
  principal: number;
  /** 当前市值 */
  currentValue: number;
  /** 累计收益 */
  totalReturn: number;
  /** 收益率 */
  returnRate: number;
  /** 持仓明细 */
  detail: Record<string, any>;
}

export interface MarketSnapshot {
  /** 基金净值 */
  fundNav: number;
  /** 基金净值日涨跌幅 */
  fundNavChange: number;
  /** 现金理财七日年化 */
  cashMgmtRate: number;
  /** 封闭式理财净值 */
  closedFundNav: number;
  /** 存款利率 */
  depositRate: number;
  /** 日期 */
  date: string;
  /** 切片索引 */
  sliceIndex: number;
}

/** 交易操作记录 */
export interface TradeRecord {
  /** 切片索引 */
  sliceIndex: number;
  /** 日期 */
  date: string;
  /** 操作类型 */
  action: '买入' | '卖出' | '申购' | '赎回' | '存入' | '取出' | '到期兑付';
  /** 资产类型 */
  assetType: AssetType;
  /** 金额 */
  amount: number;
  /** 交易时净值 */
  navAtTrade: number;
  /** 变动份额 */
  sharesChanged: number;
  /** 描述 */
  description: string;
}

/** 脚本化预定义操作 */
export interface ScriptedOperation {
  /** 在第几个切片执行（0-based） */
  atSlice: number;
  /** 操作类型 */
  action: 'invest' | 'redeem';
  /** 资产类型 */
  assetType: AssetType;
  /** 金额 */
  amount: number;
  /** 描述标签 */
  label: string;
}

export interface MarketDataItem {
  date: string;
  /** 基金净值 */
  fundNav: number;
  /** 现金理财收益率 */
  cashMgmtRate: number;
  /** 封闭式理财净值 */
  closedFundNav: number;
  /** 是否交易日 */
  isTradingDay: boolean;
  /** 临时停牌切片索引（空数组表示无停牌） */
  suspendedSlices: number[];
}
