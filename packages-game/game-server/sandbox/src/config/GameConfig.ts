/** 沙盘游戏核心配置 */
export const GameConfig = {
  /** 每个交易日切片数 */
  SLICES_PER_DAY: 52,
  /** 切片时长（毫秒） */
  SLICE_DURATION_MS: 5000,
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
  RISK_DISCLAIMER: '本沙盘仅财商教育演示，历史回放数据不等于未来收益，不构成投资建议。',
  /** 后端API地址 */
  API_BASE: '/api/sandbox/v1',
} as const;

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