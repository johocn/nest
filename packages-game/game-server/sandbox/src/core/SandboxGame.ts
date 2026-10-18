import {
  GameConfig,
  MarketSnapshot,
  SliceInfo,
  TradeRecord,
  ScriptedOperation,
  AssetType,
  AssetHolding,
  EquityPoint,
  GameSummary,
  AssetAttribution,
  AssetHistoryPoint,
  GameLevel,
  LEVELS,
  DEFAULT_LEVEL,
  ScenarioDef,
  resolveScenario,
  DEFAULT_SCENARIO,
  DcaPlan,
  DEFAULT_DCA,
} from '../config/GameConfig';
import { PlayerPortfolio } from '../entities/PortfolioEntities';
import { TradingStateMachine } from '../core/TradingStateMachine';
import { TimeSliceEngine, HolidayCallback } from '../core/TimeSliceEngine';
import { MarketDataLoader } from '../core/MarketDataLoader';
import {
  MissionSystem,
  MissionContext,
  MissionDef,
  createMissions,
} from '../core/MissionSystem';
import { Advisor, Advice } from '../core/Advisor';
import { buildReplayCsv } from '../core/ReplayExport';
import { mapTradesToCurve, TradeMarker } from '../core/TradeMarkers';

export type FinishCallback = (summary: GameSummary) => void;

const ACTION_BY_TYPE: Record<
  AssetType,
  { buy: TradeRecord['action']; sell: TradeRecord['action']; label: string }
> = {
  deposit: { buy: '存入', sell: '取出', label: '存款' },
  cash_mgmt: { buy: '申购', sell: '赎回', label: '现金理财' },
  closed_fund: { buy: '申购', sell: '赎回', label: '封闭理财' },
  fund: { buy: '买入', sell: '卖出', label: '基金' },
};

/** 沙盘游戏主控制器 */
export class SandboxGame {
  readonly stateMachine: TradingStateMachine;
  readonly sliceEngine: TimeSliceEngine;
  readonly dataLoader: MarketDataLoader;
  missions: MissionSystem;
  /** 实时财商干预（高风险配置提示） */
  readonly advisor = new Advisor();
  private _level: GameLevel;
  private _scenario: ScenarioDef;
  private _portfolio: PlayerPortfolio;

  private _isInitialized = false;
  private _running = false;
  private _tradeRecords: TradeRecord[] = [];
  private _scriptedOps: ScriptedOperation[] = [];
  private _executedOps = new Set<number>();
  private _equityCurve: EquityPoint[] = [];
  /** 分资产每日市值采样（资产面板迷你曲线） */
  private _assetHistory: AssetHistoryPoint[] = [];
  private _onFinish: FinishCallback | null = null;
  private _holidayCbs: HolidayCallback[] = [];
  private _lastFundNav = 1;
  /** 日循环代号：reset 时自增，避免旧循环与新一轮并行 */
  private _cycleToken = 0;
  /** 本局已回放的自然日数 */
  private _playedDays = 0;
  /** 封闭理财到期兑付次数 */
  private _maturedCount = 0;
  /** 经历盘中临时停牌次数 */
  private _suspendedSeen = 0;
  /** 定投计划 */
  private _dca: DcaPlan = { ...DEFAULT_DCA };
  /** 已完成的交易日计数（定投间隔用） */
  private _dcaCounter = 0;
  /** 累计定投扣款次数 */
  private _dcaCount = 0;

  constructor(
    seed: number = GameConfig.DEFAULT_SEED,
    level: GameLevel = DEFAULT_LEVEL,
    scenarioId: string = DEFAULT_SCENARIO,
    presetData?: import('../config/GameConfig').MarketDataItem[],
  ) {
    this.stateMachine = new TradingStateMachine();
    this.sliceEngine = new TimeSliceEngine(this.stateMachine);
    this._scenario = resolveScenario(scenarioId);
    this.dataLoader = new MarketDataLoader(
      seed,
      this._scenario.start,
      presetData,
    );
    this._level = level;
    this.missions = new MissionSystem(createMissions(LEVELS[level].caps));
    this._portfolio = new PlayerPortfolio(
      GameConfig.DEPOSIT_RATE,
      GameConfig.CLOSED_FUND_RATE,
      GameConfig.CLOSED_FUND_TERM_DAYS,
      GameConfig.INITIAL_PRINCIPAL,
    );
  }

  get portfolio(): PlayerPortfolio {
    return this._portfolio;
  }

  /** 当前难度档位 */
  get level(): GameLevel {
    return this._level;
  }

  /** 当前行情情景 */
  get scenario(): ScenarioDef {
    return this._scenario;
  }

  /** 本局自然日天数上限 */
  get playDays(): number {
    return this._scenario.days;
  }

  /** 当前定投计划 */
  get dca(): DcaPlan {
    return this._dca;
  }

  /** 累计定投扣款次数 */
  get dcaCount(): number {
    return this._dcaCount;
  }

  /** 设置定投计划（合并部分字段；amount/interval 需为正） */
  setDca(partial: Partial<DcaPlan>): void {
    this._dca = { ...this._dca, ...partial };
    if (this._dca.amount < 0) this._dca.amount = 0;
    if (this._dca.intervalDays < 1) this._dca.intervalDays = 1;
  }

  /** 运行中切换难度（仅影响任务卡阈值与点评，不改变行情/持仓） */
  setLevel(level: GameLevel): void {
    if (level === this._level) return;
    this._level = level;
    this.missions = new MissionSystem(createMissions(LEVELS[level].caps));
  }

  /** 切换行情情景（仅应在开局前调用：重设回放起点与天数） */
  setScenario(id: string): void {
    const s = resolveScenario(id);
    if (s.id === this._scenario.id) return;
    this._scenario = s;
    this.dataLoader.setStart(s.start);
  }

  /** 现金（可即时投资的活期资金） */
  get cash(): number {
    return this._portfolio.cash;
  }

  /** 总资产 */
  get totalAssets(): number {
    return this._portfolio.totalAssets;
  }

  /** 资产净值曲线 */
  get equityCurve(): readonly EquityPoint[] {
    return this._equityCurve;
  }

  /** 分资产每日市值采样 */
  get assetHistory(): readonly AssetHistoryPoint[] {
    return this._assetHistory;
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this._running;
  }

  /** 加载初始配置：本金¥100,000 = 现金 2 万 + 四类资产各 2 万 */
  loadTestData(): void {
    this._portfolio = new PlayerPortfolio(
      GameConfig.DEPOSIT_RATE,
      GameConfig.CLOSED_FUND_RATE,
      GameConfig.CLOSED_FUND_TERM_DAYS,
      GameConfig.INITIAL_PRINCIPAL,
    );
    this._portfolio.cash = 20000;
    this._portfolio.deposit.deposit(20000);
    this._portfolio.cashMgmt.subscribe(20000);
    this._portfolio.closedFund.subscribe(20000);
    this._portfolio.fund.buy(20000);
  }

  /** 加载脚本化操作：模拟用户在特定切片执行操作（仅执行一次） */
  loadScriptedOperations(): void {
    this._scriptedOps = [
      {
        atSlice: 10,
        action: 'invest',
        assetType: 'fund',
        amount: 10000,
        label: '脚本演示：第10切片追加买入基金 ¥10,000',
      },
    ];
    this._executedOps.clear();
  }

  /** 获取交易记录 */
  getTradeRecords(): readonly TradeRecord[] {
    return this._tradeRecords;
  }

  /** 初始化 */
  async init(): Promise<void> {
    if (this._isInitialized) return;

    this.loadTestData();
    this.loadScriptedOperations();
    this._equityCurve = [];
    this._assetHistory = [];
    this._tradeRecords = [];
    this._playedDays = 0;
    this._maturedCount = 0;
    this._suspendedSeen = 0;
    this._dcaCounter = 0;
    this._dcaCount = 0;
    this.missions.reset();
    this.advisor.reset();
    this._lastFundNav = this.dataLoader.getCurrentDay()?.fundNav ?? 1;

    // 初始化市场数据到时间轴引擎
    this.sliceEngine.setMarketData(this.dataLoader.getAll());

    // 注册切片回调 - 更新资产净值
    this.sliceEngine.onSliceTick((slice, progress) =>
      this._onSliceTick(slice, progress),
    );

    // 注册日完成回调 - 封盘清算
    this.sliceEngine.onDayComplete((dayInfo) => this._onDayComplete(dayInfo));

    this._isInitialized = true;
  }

  /** 开始游戏 */
  async start(): Promise<void> {
    if (!this._isInitialized) await this.init();
    if (this._running) return;
    this._running = true;
    await this._runDayCycle(++this._cycleToken);
  }

  /** 设置速度倍率 */
  setSpeed(multiplier: number): void {
    this.sliceEngine.setSpeed(multiplier);
  }

  /** 暂停推进（切片停在原地，仍可交易） */
  pause(): void {
    this.sliceEngine.pause();
  }

  /** 继续推进 */
  resume(): void {
    this.sliceEngine.resume();
  }

  /** 是否暂停 */
  get isPaused(): boolean {
    return this.sliceEngine.isPaused;
  }

  /** 停止 */
  stop(): void {
    this._running = false;
    this.sliceEngine.stop();
  }

  /** 重置：回到数据起点与初始持仓 */
  async reset(): Promise<void> {
    this.stop();
    this._cycleToken++; // 作废旧循环
    this._isInitialized = false;
    this.sliceEngine.reset();
    this.dataLoader.reset();
    await this.init();
  }

  /** 注册结算回调（行情回放走完时触发） */
  onFinish(cb: FinishCallback): void {
    this._onFinish = cb;
  }

  /** 注册休市回调（可多个；休市日由日循环直接推进并触发） */
  onHoliday(cb: HolidayCallback): void {
    this._holidayCbs.push(cb);
  }

  /** 进度：已回放自然日 / 本局总天数 */
  get dayProgress(): { current: number; total: number } {
    return {
      current: Math.min(this._playedDays + 1, this._scenario.days),
      total: this._scenario.days,
    };
  }

  /** 获取当前市场快照 */
  getCurrentSnapshot(): MarketSnapshot | null {
    const dayData = this.dataLoader.getCurrentDay();
    if (!dayData) return null;
    return {
      fundNav: dayData.fundNav,
      fundNavChange:
        this._lastFundNav > 0 ? dayData.fundNav / this._lastFundNav - 1 : 0,
      cashMgmtRate: dayData.cashMgmtRate,
      closedFundNav: dayData.closedFundNav,
      depositRate: GameConfig.DEPOSIT_RATE,
      date: dayData.date,
      sliceIndex: this.sliceEngine.currentSliceIndex,
    };
  }

  /** 获取资产持有数据 */
  getHoldings(): AssetHolding[] {
    return this._portfolio.getAllHoldings();
  }

  /** 当前是否可交易（休市 / 临时停牌 / 封盘禁止，其余时段均可） */
  get canTrade(): boolean {
    const phase = this.stateMachine.current;
    return (
      phase !== 'holiday' && phase !== 'suspended' && phase !== 'forced_close'
    );
  }

  /** 投资操作（现金 → 资产） */
  async invest(type: string, amount: number): Promise<boolean> {
    if (!this.canTrade) return false;
    if (amount <= 0 || amount > this._portfolio.cash) return false;
    return this._applyBuy(type as AssetType, amount, null);
  }

  /** 执行买入并记流水（description 为 null 时用默认文案；供手动与定投共用） */
  private _applyBuy(
    assetType: AssetType,
    amount: number,
    description: string | null,
  ): boolean {
    const meta = ACTION_BY_TYPE[assetType];
    if (!meta) return false;

    const navAtTrade = this._navOf(assetType);
    this._portfolio.cash -= amount;
    let sharesChanged = amount;

    switch (assetType) {
      case 'deposit':
        this._portfolio.deposit.deposit(amount);
        break;
      case 'cash_mgmt':
        sharesChanged = this._portfolio.cashMgmt.subscribe(amount);
        break;
      case 'closed_fund':
        this._portfolio.closedFund.subscribe(amount);
        break;
      case 'fund':
        sharesChanged = this._portfolio.fund.buy(amount);
        break;
    }

    this._recordTrade(
      meta.buy,
      assetType,
      amount,
      navAtTrade,
      sharesChanged,
      description ?? `${meta.label} ¥${amount.toFixed(0)}`,
    );
    return true;
  }

  /** 赎回操作（资产 → 现金）；不传 amount 表示全部赎回 */
  async redeem(type: string, amount?: number): Promise<number> {
    const assetType = type as AssetType;
    const meta = ACTION_BY_TYPE[assetType];
    if (!meta) return 0;

    const navAtTrade = this._navOf(assetType);
    let cashBack = 0;
    let sharesChanged = 0;
    let actually = 0;

    switch (assetType) {
      case 'deposit':
        cashBack = this._portfolio.deposit.withdraw(
          amount ?? this._portfolio.deposit.principal,
        );
        sharesChanged = cashBack;
        actually = cashBack;
        break;
      case 'cash_mgmt': {
        const shares = amount
          ? Math.min(
              amount / this._portfolio.cashMgmt.nav,
              this._portfolio.cashMgmt.shares,
            )
          : this._portfolio.cashMgmt.shares;
        cashBack = this._portfolio.cashMgmt.redeem(shares);
        sharesChanged = shares;
        actually = cashBack;
        break;
      }
      case 'closed_fund':
        if (!this._portfolio.closedFund.isMatured) return 0; // 未到期不可赎回
        cashBack = this._portfolio.closedFund.redeem();
        sharesChanged = cashBack;
        actually = cashBack;
        break;
      case 'fund': {
        const shares = amount
          ? Math.min(
              amount / this._portfolio.fund.nav,
              this._portfolio.fund.shares,
            )
          : this._portfolio.fund.shares;
        cashBack = this._portfolio.fund.sell(shares);
        sharesChanged = shares;
        actually = cashBack;
        break;
      }
    }

    if (cashBack <= 0) return 0;
    this._portfolio.cash += cashBack;
    this._recordTrade(
      meta.sell,
      assetType,
      actually,
      navAtTrade,
      sharesChanged,
      `${meta.label} ¥${actually.toFixed(0)}`,
    );
    return cashBack;
  }

  /** 某资产是否当前可赎回（封闭理财未到期则不可） */
  isRedeemable(type: string): boolean {
    if (type === 'closed_fund') return this._portfolio.closedFund.isMatured;
    return true;
  }

  /** 生成结算成绩单 */
  getSummary(): GameSummary {
    const curve = this._equityCurve;
    const start = curve[0];
    const last = curve[curve.length - 1];
    const days = Math.max(1, curve.length);
    const principal = this._portfolio.initialPrincipal;
    const totalAssets = this._portfolio.totalAssets;
    const totalReturn = totalAssets - principal;
    const totalReturnRate = principal > 0 ? totalReturn / principal : 0;
    const annualizedReturn =
      totalAssets > 0 && days > 0
        ? Math.pow(1 + totalReturnRate, 365 / days) - 1
        : 0;

    const maxDrawdown = this._computeMaxDrawdown();

    const { rating, reason } = ratePerformance(annualizedReturn, maxDrawdown);

    const environment = this._buildEnvironment(totalReturnRate, maxDrawdown);

    return {
      level: this._level,
      scenario: { id: this._scenario.id, name: this._scenario.name },
      startDate: start?.date ?? '',
      endDate: last?.date ?? '',
      days,
      principal,
      totalAssets,
      totalReturn,
      totalReturnRate,
      annualizedReturn,
      maxDrawdown,
      holdings: this.getHoldings(),
      tradeCount: this._tradeRecords.length,
      dcaCount: this._dcaCount,
      missions: {
        completed: this.missions.completed,
        total: this.missions.total,
      },
      attribution: this._buildAttribution(),
      timeline: this._tradeRecords.slice(-12).map((r) => ({
        date: r.date,
        action: r.action,
        amount: r.amount,
        description: r.description,
      })),
      rating,
      ratingReason: reason,
      environment,
    };
  }

  /** 基于收益/回撤生成市场环境点评（教学向） */
  private _buildEnvironment(
    rate: number,
    dd: number,
  ): { label: string; advice: string } {
    const levelName = LEVELS[this._level].name;
    if (rate < -0.02) {
      return {
        label: `${levelName} · 亏损市`,
        advice:
          '市场走弱时，现金与存款就是你的安全垫——别在恐慌中割肉，留得青山在。',
      };
    }
    if (dd > LEVELS[this._level].caps.drawdownCap + 0.06) {
      return {
        label: `${levelName} · 高波动市`,
        advice:
          '这局波动超出了目标，下次记得先把权益仓位和最大回撤控制住再图收益。',
      };
    }
    if (dd < 0.03 && rate > 0) {
      return {
        label: `${levelName} · 低波动慢牛`,
        advice:
          '稳健复利最舒服：少操作、多持有，让时间替你赚钱，别被频繁交易吃掉收益。',
      };
    }
    return {
      label: `${levelName} · 震荡市`,
      advice:
        '震荡市最适合做再平衡——涨多的减一点、跌多的补一点，把配置拉回目标区间。',
    };
  }

  /** 任务评估上下文快照 */
  getMissionContext(): MissionContext {
    return {
      portfolio: this._portfolio,
      cash: this._portfolio.cash,
      totalAssets: this._portfolio.totalAssets,
      tradeCount: this._tradeRecords.length,
      maturedCount: this._maturedCount,
      suspendedSeen: this._suspendedSeen,
      days: this._equityCurve.length,
      maxDrawdown: this._computeMaxDrawdown(),
    };
  }

  /** 评估一次教学目标，返回本次新达成的任务 */
  evaluateMissions(): MissionDef[] {
    return this.missions.evaluate(this.getMissionContext());
  }

  /** 评估一次实时财商干预，返回本次新触发的建议 */
  evaluateAdvisor(): Advice[] {
    return this.advisor.evaluate(
      this.getMissionContext(),
      this.getCurrentSnapshot(),
    );
  }

  /** 导出复盘报告 CSV（成绩单 + 归因 + 完整流水） */
  exportReplayCsv(): string {
    return buildReplayCsv(this.getSummary(), this._tradeRecords);
  }

  /** 交易买卖点（映射到净值曲线索引，供曲线标注） */
  getTradeMarkers(): TradeMarker[] {
    return mapTradesToCurve(this._tradeRecords, this._equityCurve);
  }

  /** 收益归因：按交易流水 + 期末市值，拆出每类资产的贡献 */
  private _buildAttribution(): AssetAttribution[] {
    const names: Record<AssetType, string> = {
      deposit: '存款',
      cash_mgmt: '现金理财',
      closed_fund: '封闭理财',
      fund: '基金',
    };
    const invested: Record<string, number> = {};
    const redeemed: Record<string, number> = {};
    for (const r of this._tradeRecords) {
      const isOut =
        r.action === '买入' || r.action === '申购' || r.action === '存入';
      const bucket = isOut ? invested : redeemed;
      bucket[r.assetType] = (bucket[r.assetType] ?? 0) + r.amount;
    }
    return this.getHoldings().map((h) => ({
      type: h.type,
      name: names[h.type] ?? h.type,
      invested: invested[h.type] ?? 0,
      redeemed: redeemed[h.type] ?? 0,
      currentValue: h.currentValue,
      contribution:
        h.currentValue + (redeemed[h.type] ?? 0) - (invested[h.type] ?? 0),
    }));
  }

  /** 按净值曲线计算最大回撤 */
  private _computeMaxDrawdown(): number {
    let peak = 0;
    let maxDrawdown = 0;
    for (const p of this._equityCurve) {
      if (p.total > peak) peak = p.total;
      if (peak > 0) {
        const dd = (peak - p.total) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
    }
    return maxDrawdown;
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
    if (this._tradeRecords.length > 200) this._tradeRecords.shift();
  }

  private _navOf(type: AssetType): number {
    switch (type) {
      case 'cash_mgmt':
        return this._portfolio.cashMgmt.nav;
      case 'fund':
        return this._portfolio.fund.nav;
      default:
        return 1;
    }
  }

  /** 切片回调 - 更新净值 */
  private _onSliceTick(slice: SliceInfo, _progress: number): void {
    const dayData = this.dataLoader.getCurrentDay();
    if (!dayData) return;

    // 记录盘中临时停牌（教学点：流动性风险）
    if (slice.isSuspended) this._suspendedSeen++;

    // 检查是否有脚本化操作需要在当前切片执行（只执行一次）
    this._scriptedOps.forEach((op, i) => {
      if (op.atSlice === slice.index && !this._executedOps.has(i)) {
        this._executedOps.add(i);
        this._executeScriptedOp(op);
      }
    });

    // 基金净值跟随市场数据
    this._portfolio.fund.updateNav(dayData.fundNav);

    // 每日一次（首个切片）：现金理财计息 / 存款计息 / 封闭理财持有期推进
    if (slice.index === 0) {
      this._portfolio.cashMgmt.accrueDaily(1, dayData.cashMgmtRate);
      this._portfolio.deposit.accrueInterest(1);
      this._portfolio.closedFund.advanceDays(1);
    }
  }

  /** 执行脚本化操作 */
  private _executeScriptedOp(op: ScriptedOperation): void {
    if (op.action === 'invest') {
      if (this._portfolio.cash < op.amount) {
        console.warn(`[脚本操作] ${op.label} 失败：现金不足`);
        return;
      }
      this._portfolio.cash -= op.amount;
      const nav = this._navOf(op.assetType);
      let shares = op.amount;
      switch (op.assetType) {
        case 'fund':
          shares = this._portfolio.fund.buy(op.amount);
          break;
        case 'deposit':
          this._portfolio.deposit.deposit(op.amount);
          break;
        case 'cash_mgmt':
          shares = this._portfolio.cashMgmt.subscribe(op.amount);
          break;
        case 'closed_fund':
          this._portfolio.closedFund.subscribe(op.amount);
          break;
      }
      this._recordTrade(
        ACTION_BY_TYPE[op.assetType].buy,
        op.assetType,
        op.amount,
        nav,
        shares,
        op.label,
      );
      console.log(`[脚本操作] ✅ ${op.label}`);
    }
  }

  /** 日完成回调 - 封盘清算 */
  private _onDayComplete(_dayInfo: {
    date: string;
    slicesCompleted: number;
    totalSlices: number;
  }): void {
    const dayData = this.dataLoader.getCurrentDay();
    this._lastFundNav = dayData?.fundNav ?? this._lastFundNav;

    // 清算：封闭式理财到期自动兑付
    if (
      this._portfolio.closedFund.isMatured &&
      this._portfolio.closedFund.principal > 0
    ) {
      const value = this._portfolio.closedFund.redeem();
      if (value > 0) {
        this._portfolio.cash += value;
        this._maturedCount++;
        this._recordTrade(
          '到期兑付',
          'closed_fund',
          value,
          1,
          value,
          `封闭理财到期兑付 ¥${value.toFixed(0)}`,
        );
      }
    }

    // 采样净值曲线
    if (dayData) {
      this._equityCurve.push({
        date: dayData.date,
        total: this._portfolio.totalAssets,
        fundNav: dayData.fundNav,
      });
      this._assetHistory.push({
        date: dayData.date,
        cash: this._portfolio.cash,
        deposit: this._portfolio.deposit.principal,
        cashMgmt: this._portfolio.cashMgmt.currentValue,
        closedFund: this._portfolio.closedFund.currentValue,
        fund: this._portfolio.fund.currentValue,
      });
      // 定投：每 intervalDays 个交易日收盘后扣款买入（现金不足则跳过本期）
      if (dayData.isTradingDay) {
        this._dcaCounter++;
        this._runDca();
      }
    }
  }

  /** 执行一次定投扣款（到期且现金充足时） */
  private _runDca(): void {
    const plan = this._dca;
    if (!plan.enabled || plan.amount <= 0) return;
    if (this._dcaCounter % plan.intervalDays !== 0) return;
    if (this._portfolio.cash < plan.amount) return;
    const ok = this._applyBuy(
      plan.asset,
      plan.amount,
      `定投扣款 ¥${plan.amount.toFixed(0)}`,
    );
    if (ok) this._dcaCount++;
  }

  /** 运行交易日循环（按自然日推进，含休市日） */
  private async _runDayCycle(token: number): Promise<void> {
    const alive = () => this._running && token === this._cycleToken;

    while (alive()) {
      if (
        !this.dataLoader.hasNext() ||
        this._playedDays >= this._scenario.days
      ) {
        this._running = false;
        this._onFinish?.(this.getSummary());
        return;
      }

      const dayData = this.dataLoader.nextDay();
      this._playedDays++;

      // 休市日：触发休市回调后短暂停留跳过（避免空转刷屏）
      if (!dayData.isTradingDay) {
        this.stateMachine.transition('holiday', `休市日: ${dayData.date}`);
        for (const cb of this._holidayCbs) {
          try {
            cb(dayData.date);
          } catch (e) {
            console.error('[SandboxGame] holiday listener error:', e);
          }
        }
        await this.sliceEngine.waitScaled(GameConfig.HOLIDAY_SKIP_MS);
        if (!alive()) return;
        continue;
      }

      await this.sliceEngine.startTradingDay(this.dataLoader.currentIndex);
      if (!alive()) return;

      if (this.dataLoader.isFinished) {
        this._running = false;
        this._onFinish?.(this.getSummary());
        return;
      }
    }
  }
}

/** 综合评级：看年化收益与最大回撤 */
function ratePerformance(
  annualized: number,
  drawdown: number,
): { rating: string; reason: string } {
  if (annualized >= 0.06 && drawdown <= 0.15) {
    return {
      rating: 'A · 稳健进取',
      reason: '年化达标且回撤可控，配置结构健康',
    };
  }
  if (annualized >= 0.06) {
    return {
      rating: 'B · 高波动进取',
      reason: '收益达标但回撤偏大，权益仓位过重',
    };
  }
  if (annualized >= 0.03) {
    return {
      rating: 'B · 均衡配置',
      reason: '收益与风险平衡，可适度优化资产结构',
    };
  }
  if (annualized >= 0) {
    return {
      rating: 'C · 偏保守',
      reason: '跑赢通胀但收益偏低，可提升生息资产比例',
    };
  }
  return {
    rating: 'D · 需复盘',
    reason: '出现亏损，建议回看买入时点与仓位集中度',
  };
}
