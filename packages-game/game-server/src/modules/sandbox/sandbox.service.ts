import { Injectable, Logger } from '@nestjs/common';

export interface MarketDataItem {
  date: string;
  fundNav: number;
  cashMgmtRate: number;
  closedFundNav: number;
  isTradingDay: boolean;
  suspendedSlices: number[];
}

export interface PortfolioState {
  cash: number;
  deposit: { principal: number; rate: number };
  cashMgmt: { shares: number; nav: number };
  closedFund: { principal: number; isMatured: boolean; elapsedDays: number; termDays: number; rate: number };
  fund: { shares: number; nav: number };
}

export interface GameState {
  dateIndex: number;
  sliceIndex: number;
  phase: string;
  portfolio: PortfolioState;
  currentDate: string;
  marketSnapshot: MarketDataItem | null;
}

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);
  private _marketData: MarketDataItem[] = [];
  private _gameState: GameState;

  constructor() {
    this._marketData = this._generateMockData();
    this._gameState = this._initGameState();
  }

  /** 获取市场数据 */
  getMarketData(page: number = 1, pageSize: number = 30) {
    const start = (page - 1) * pageSize;
    const items = this._marketData.slice(start, start + pageSize);
    return {
      items,
      total: this._marketData.length,
      page,
      pageSize,
    };
  }

  /** 获取当前游戏状态 */
  getGameState(): GameState {
    return this._gameState;
  }

  /** 推进切片 */
  advanceSlice(): GameState {
    const dayData = this._marketData[this._gameState.dateIndex];
    this._gameState.sliceIndex++;

    if (this._gameState.sliceIndex >= 52) {
      // 封盘清算
      this._gameState.phase = 'settlement';
      this._settleDay();
      // 进入下一个交易日
      this._gameState.dateIndex = (this._gameState.dateIndex + 1) % this._marketData.length;
      this._gameState.sliceIndex = 0;
      this._gameState.phase = 'trading';
    }

    // 更新市场数据
    this._updateMarketSnapshot();

    // 检查临时停牌
    if (dayData.suspendedSlices.includes(this._gameState.sliceIndex)) {
      this._gameState.phase = 'suspended';
    } else if (this._gameState.phase === 'suspended') {
      this._gameState.phase = 'trading';
    }

    // 资产净值更新
    this._updatePortfolio();

    return this._gameState;
  }

  /** 投资操作 */
  invest(type: string, amount: number): { success: boolean; message: string; state: GameState } {
    if (this._gameState.phase !== 'trading') {
      return { success: false, message: '当前不可交易', state: this._gameState };
    }
    if (amount <= 0 || amount > this._gameState.portfolio.cash) {
      return { success: false, message: '金额不足', state: this._gameState };
    }

    this._gameState.portfolio.cash -= amount;

    switch (type) {
      case 'deposit':
        this._gameState.portfolio.deposit.principal += amount;
        break;
      case 'cash_mgmt':
        this._gameState.portfolio.cashMgmt.shares += amount / this._gameState.portfolio.cashMgmt.nav;
        break;
      case 'closed_fund':
        this._gameState.portfolio.closedFund.principal += amount;
        this._gameState.portfolio.closedFund.elapsedDays = 0;
        this._gameState.portfolio.closedFund.isMatured = false;
        break;
      case 'fund':
        this._gameState.portfolio.fund.shares += amount / this._gameState.portfolio.fund.nav;
        break;
      default:
        this._gameState.portfolio.cash += amount;
        return { success: false, message: '未知类型', state: this._gameState };
    }

    return { success: true, message: '成交', state: this._gameState };
  }

  /** 重置游戏 */
  reset(): GameState {
    this._gameState = this._initGameState();
    return this._gameState;
  }

  private _initGameState(): GameState {
    const firstDay = this._marketData[0];
    return {
      dateIndex: 0,
      sliceIndex: 0,
      phase: 'trading',
      portfolio: {
        cash: 20000,
        deposit: { principal: 20000, rate: 0.0175 },
        cashMgmt: { shares: 20000, nav: 1.0 },
        closedFund: { principal: 20000, isMatured: false, elapsedDays: 0, termDays: 90, rate: 0.038 },
        fund: { shares: 20000, nav: firstDay.fundNav },
      },
      currentDate: firstDay.date,
      marketSnapshot: firstDay,
    };
  }

  private _updateMarketSnapshot(): void {
    const dayData = this._marketData[this._gameState.dateIndex];
    this._gameState.currentDate = dayData.date;
    this._gameState.marketSnapshot = dayData;
  }

  private _updatePortfolio(): void {
    const dayData = this._marketData[this._gameState.dateIndex];
    if (!dayData) return;

    // 基金净值更新
    this._gameState.portfolio.fund.nav = dayData.fundNav;

    // 现金理财按日计息
    const dailyReturn = 1 + dayData.cashMgmtRate / 365;
    this._gameState.portfolio.cashMgmt.nav *= dailyReturn;

    // 存款计息
    this._gameState.portfolio.deposit.principal *= (1 + 0.0175 / 365);

    // 封闭理财持有期推进
    if (!this._gameState.portfolio.closedFund.isMatured) {
      this._gameState.portfolio.closedFund.elapsedDays++;
      if (this._gameState.portfolio.closedFund.elapsedDays >= this._gameState.portfolio.closedFund.termDays) {
        this._gameState.portfolio.closedFund.isMatured = true;
      }
    }
  }

  private _settleDay(): void {
    // 封闭理财到期兑付
    if (this._gameState.portfolio.closedFund.isMatured) {
      const value = this._gameState.portfolio.closedFund.principal *
        (1 + this._gameState.portfolio.closedFund.rate * (this._gameState.portfolio.closedFund.termDays / 365));
      this._gameState.portfolio.cash += value;
      this._gameState.portfolio.closedFund.principal = 0;
    }
  }

  private _generateMockData(): MarketDataItem[] {
    const data: MarketDataItem[] = [];
    const start = new Date('2022-01-01');
    const end = new Date('2026-07-01');
    let fundNav = 1.0;
    let closedFundNav = 1.0;

    const holidays = new Set<string>();
    const addHoliday = (year: number, month: number, day: number, days: number) => {
      for (let i = 0; i < days; i++) {
        const d = new Date(year, month - 1, day + i);
        holidays.add(d.toISOString().slice(0, 10));
      }
    };
    for (const y of [2022, 2023, 2024, 2025, 2026]) {
      addHoliday(y, 1, 1, 3);   // 元旦
      addHoliday(y, 2, 1, 7);   // 春节
      addHoliday(y, 5, 1, 3);   // 五一
      addHoliday(y, 10, 1, 7);  // 国庆
    }

    const cur = new Date(start);
    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10);
      const dow = cur.getDay();
      const isTradingDay = !(dow === 0 || dow === 6) && !holidays.has(dateStr);

      const fundChange = isTradingDay ? (Math.random() - 0.48) * 0.04 : 0;
      const closedChange = isTradingDay ? (Math.random() - 0.45) * 0.02 : 0;
      fundNav = Math.max(0.5, fundNav * (1 + fundChange));
      closedFundNav = Math.max(0.8, closedFundNav * (1 + closedChange));

      const suspendedSlices: number[] = [];
      if (isTradingDay && Math.random() < 0.05) {
        suspendedSlices.push(Math.floor(Math.random() * 52));
      }

      data.push({
        date: dateStr,
        fundNav: Math.round(fundNav * 10000) / 10000,
        cashMgmtRate: 0.025 + (Math.random() - 0.5) * 0.01,
        closedFundNav: Math.round(closedFundNav * 10000) / 10000,
        isTradingDay,
        suspendedSlices,
      });

      cur.setDate(cur.getDate() + 1);
    }

    return data;
  }
}