import { GameConfig, MarketSnapshot, SliceInfo, TradeRecord, ScriptedOperation, AssetType } from '../config/GameConfig';
import { PlayerPortfolio } from '../entities/PortfolioEntities';
import { TradingStateMachine } from '../core/TradingStateMachine';
import { TimeSliceEngine, HolidayCallback } from '../core/TimeSliceEngine';
import { MarketDataLoader } from '../core/MarketDataLoader';

/** 沙盘游戏主控制器 */
export class SandboxGame {
  readonly stateMachine: TradingStateMachine;
  readonly sliceEngine: TimeSliceEngine;
  readonly dataLoader: MarketDataLoader;
  readonly portfolio: PlayerPortfolio;

  private _isInitialized = false;
  private _speedMultiplier = 1;
  private _fundNavHistory: number[] = [];
  private _tradeRecords: TradeRecord[] = [];
  private _scriptedOps: ScriptedOperation[] = [];

  constructor() {
    this.stateMachine = new TradingStateMachine();
    this.sliceEngine = new TimeSliceEngine(this.stateMachine);
    this.dataLoader = new MarketDataLoader();
    this.portfolio = new PlayerPortfolio(
      GameConfig.DEPOSIT_RATE,
      GameConfig.CLOSED_FUND_RATE,
      GameConfig.CLOSED_FUND_TERM_DAYS,
      GameConfig.INITIAL_PRINCIPAL,
    );
  }

  /** 加载测试数据：初始本金¥100,000分散到各资产 */
  loadTestData(): void {
    this.portfolio.cash = 20000;
    this.portfolio.deposit.deposit(20000);
    this.portfolio.cashMgmt.subscribe(20000);
    this.portfolio.closedFund.subscribe(20000);
    this.portfolio.fund.buy(20000);
  }

  /** 加载脚本化操作：模拟用户在特定切片执行操作 */
  loadScriptedOperations(): void {
    this._scriptedOps = [
      {
        atSlice: 10,
        action: 'invest',
        assetType: 'fund',
        amount: 10000,
        label: '第10切片追加买入基金 ¥10,000',
      },
    ];
  }

  /** 获取交易记录 */
  getTradeRecords(): readonly TradeRecord[] {
    return this._tradeRecords;
  }

  /** 初始化 */
  async init(): Promise<void> {
    if (this._isInitialized) return;

    // 加载测试持仓数据
    this.loadTestData();
    // 加载脚本化操作
    this.loadScriptedOperations();

    // 初始化市场数据到时间轴引擎
    this.sliceEngine.setMarketData(this.dataLoader.getAll());

    // 注册休市回调
    this.sliceEngine.onHoliday(date => {
      console.log(`[休市] ${date}`);
    });

    // 注册切片回调 - 更新资产净值
    this.sliceEngine.onSliceTick((slice, progress) => this._onSliceTick(slice, progress));

    // 注册日完成回调 - 封盘清算
    this.sliceEngine.onDayComplete(dayInfo => this._onDayComplete(dayInfo));

    this._isInitialized = true;
  }

  /** 开始游戏 */
  async start(): Promise<void> {
    if (!this._isInitialized) await this.init();
    await this._runDayCycle();
  }

  /** 设置速度倍率 */
  setSpeed(multiplier: number): void {
    this._speedMultiplier = Math.max(0.5, Math.min(10, multiplier));
  }

  /** 获取当前市场快照 */
  getCurrentSnapshot(): MarketSnapshot | null {
    const dayData = this.dataLoader.getCurrentDay();
    if (!dayData) return null;
    return {
      fundNav: dayData.fundNav,
      fundNavChange: 0,
      cashMgmtRate: dayData.cashMgmtRate,
      closedFundNav: dayData.closedFundNav,
      depositRate: GameConfig.DEPOSIT_RATE,
      date: dayData.date,
      sliceIndex: this.sliceEngine.currentSliceIndex,
    };
  }

  /** 获取资产持有数据 */
  getHoldings() {
    return this.portfolio.getAllHoldings();
  }

  /** 投资操作 */
  async invest(type: string, amount: number): Promise<boolean> {
    if (!this.stateMachine.isTradable && !this.stateMachine.isSubscribable) return false;
    if (amount <= 0 || amount > this.portfolio.cash) return false;

    this.portfolio.cash -= amount;

    switch (type) {
      case 'deposit':
        this.portfolio.deposit.deposit(amount);
        break;
      case 'cash_mgmt':
        this.portfolio.cashMgmt.subscribe(amount);
        break;
      case 'closed_fund':
        this.portfolio.closedFund.subscribe(amount);
        break;
      case 'fund':
        this.portfolio.fund.buy(amount);
        break;
      default:
        this.portfolio.cash += amount; // 回退
        return false;
    }
    return true;
  }

  /** 赎回操作 */
  async redeem(type: string, amount?: number): Promise<number> {
    switch (type) {
      case 'deposit':
        return this.portfolio.deposit.withdraw(amount ?? this.portfolio.deposit.principal);
      case 'cash_mgmt': {
        const shares = amount ? amount / this.portfolio.cashMgmt.nav : this.portfolio.cashMgmt.shares;
        return this.portfolio.cashMgmt.redeem(shares);
      }
      case 'closed_fund':
        if (!this.portfolio.closedFund.isMatured) return 0;
        return this.portfolio.closedFund.redeem();
      case 'fund': {
        const shares = amount ? amount / this.portfolio.fund.nav : this.portfolio.fund.shares;
        return this.portfolio.fund.sell(shares);
      }
      default:
        return 0;
    }
  }

  /** 记录一笔交易 */
  private _recordTrade(
    action: TradeRecord['action'],
    assetType: AssetType,
    amount: number,
    navAtTrade: number,
    sharesChanged: number,
    description: string,
  ): void {
    const dayData = this.dataLoader.getCurrentDay();
    this._tradeRecords.push({
      sliceIndex: this.sliceEngine.currentSliceIndex,
      date: dayData?.date ?? '',
      action,
      assetType,
      amount,
      navAtTrade,
      sharesChanged,
      description,
    });
  }

  /** 切片回调 - 更新净值 */
  private _onSliceTick(slice: SliceInfo, progress: number): void {
    const dayData = this.dataLoader.getCurrentDay();
    if (!dayData) return;

    // 检查是否有脚本化操作需要在当前切片执行
    for (const op of this._scriptedOps) {
      if (op.atSlice === slice.index) {
        this._executeScriptedOp(op);
      }
    }

    // 基金净值跟随市场数据
    this.portfolio.fund.updateNav(dayData.fundNav);

    // 现金理财按日计息（使用当日收益率）
    this.portfolio.cashMgmt.accrueDaily(1, dayData.cashMgmtRate);

    // 存款计息（每日首个切片执行一次）
    if (slice.index === 0) {
      this.portfolio.deposit.accrueInterest(1);
    }

    // 封闭式理财持有期推进（加速模拟：每个切片推进1天）
    this.portfolio.closedFund.advanceDays(1);
  }

  /** 执行脚本化操作 */
  private _executeScriptedOp(op: ScriptedOperation): void {
    const dayData = this.dataLoader.getCurrentDay();
    const dateStr = dayData?.date ?? '';
    const sliceIdx = this.sliceEngine.currentSliceIndex;

    if (op.action === 'invest') {
      if (this.portfolio.cash < op.amount) {
        console.warn(`[脚本操作] ${op.label} 失败：现金不足`);
        return;
      }

      this.portfolio.cash -= op.amount;

      switch (op.assetType) {
        case 'fund': {
          const nav = this.portfolio.fund.nav;
          const shares = op.amount / nav;
          this.portfolio.fund.buy(op.amount);
          this._recordTrade('买入', 'fund', op.amount, nav, shares, `${op.label}（净值 ${nav.toFixed(4)}）`);
          break;
        }
        case 'deposit':
          this.portfolio.deposit.deposit(op.amount);
          this._recordTrade('存入', 'deposit', op.amount, 1, op.amount, op.label);
          break;
        case 'cash_mgmt': {
          const nav = this.portfolio.cashMgmt.nav;
          const shares = this.portfolio.cashMgmt.subscribe(op.amount);
          this._recordTrade('申购', 'cash_mgmt', op.amount, nav, shares, op.label);
          break;
        }
        case 'closed_fund':
          this.portfolio.closedFund.subscribe(op.amount);
          this._recordTrade('申购', 'closed_fund', op.amount, 1, op.amount, op.label);
          break;
      }

      console.log(`[脚本操作] ✅ ${op.label}`);
    }
  }

  /** 日完成回调 - 封盘清算 */
  private _onDayComplete(dayInfo: { date: string; slicesCompleted: number; totalSlices: number }): void {
    // 清算：封闭式理财到期自动兑付
    if (this.portfolio.closedFund.isMatured) {
      const value = this.portfolio.closedFund.redeem();
      this.portfolio.cash += value;
    }
  }

  /** 运行一个交易日循环（按日历日推进，含休市日） */
  private async _runDayCycle(): Promise<void> {
    while (true) {
      const dayData = this.dataLoader.nextDay();
      await this.sliceEngine.startTradingDay(this.dataLoader.currentIndex);
    }
  }
}