import { AssetHolding, AssetType } from '../config/GameConfig';

/** 存款账户 */
export class DepositAccount {
  readonly type: AssetType = 'deposit';
  principal: number = 0;
  private _rate: number;
  /** 累计存入本金（不含利息，用于收益率口径） */
  private _totalInvested: number = 0;

  constructor(rate: number) {
    this._rate = rate;
  }

  /** 存入 */
  deposit(amount: number): void {
    this.principal += amount;
    this._totalInvested += amount;
  }

  /** 取出 */
  withdraw(amount: number): number {
    const actual = Math.min(amount, this.principal);
    if (actual <= 0) return 0;
    // 取出时按同比例冲减本金基数（利息部分优先视为收益）
    const ratio = this.principal > 0 ? actual / this.principal : 0;
    this._totalInvested = Math.max(0, this._totalInvested * (1 - ratio));
    this.principal -= actual;
    return actual;
  }

  /** 按日计息 */
  accrueInterest(days: number): number {
    const interest = this.principal * (this._rate / 365) * days;
    this.principal += interest;
    return interest;
  }

  get totalReturn(): number {
    return this.principal - this._totalInvested;
  }

  get returnRate(): number {
    return this._totalInvested > 0 ? this.totalReturn / this._totalInvested : 0;
  }

  toHolding(): AssetHolding {
    return {
      type: this.type,
      principal: this._totalInvested,
      currentValue: this.principal,
      totalReturn: this.totalReturn,
      returnRate: this.returnRate,
      detail: { rate: this._rate },
    };
  }
}

/** 现金理财产品 */
export class CashManagement {
  readonly type: AssetType = 'cash_mgmt';
  shares: number = 0;
  nav: number = 1.0;
  private _totalInvested: number = 0;

  /** 申购 */
  subscribe(amount: number): number {
    const share = amount / this.nav;
    this.shares += share;
    this._totalInvested += amount;
    return share;
  }

  /** 赎回 */
  redeem(shares: number): number {
    const actual = Math.min(shares, this.shares);
    if (actual <= 0) return 0;
    const amount = actual * this.nav;
    // 成本基数按赎回份额比例冲减，避免收益率虚低
    this._totalInvested = Math.max(
      0,
      this._totalInvested * (1 - actual / this.shares),
    );
    this.shares -= actual;
    return amount;
  }

  /** 更新净值 */
  updateNav(newNav: number): void {
    this.nav = newNav;
  }

  /** 自然日计息 */
  accrueDaily(days: number, annualRate: number): void {
    // 现金理财每日计息，净值增长
    const dailyReturn = annualRate / 365;
    this.nav *= Math.pow(1 + dailyReturn, days);
  }

  get currentValue(): number {
    return this.shares * this.nav;
  }

  get totalReturn(): number {
    return this.currentValue - this._totalInvested;
  }

  get returnRate(): number {
    return this._totalInvested > 0 ? this.totalReturn / this._totalInvested : 0;
  }

  toHolding(): AssetHolding {
    return {
      type: this.type,
      principal: this._totalInvested,
      currentValue: this.currentValue,
      totalReturn: this.totalReturn,
      returnRate: this.returnRate,
      detail: { shares: this.shares, nav: this.nav },
    };
  }
}

/** 封闭式理财产品 */
export class ClosedEndFund {
  readonly type: AssetType = 'closed_fund';
  principal: number = 0;
  private _rate: number;
  private _termDays: number;
  private _elapsedDays: number = 0;
  private _isMatured: boolean = false;

  constructor(rate: number, termDays: number) {
    this._rate = rate;
    this._termDays = termDays;
  }

  /** 申购 */
  subscribe(amount: number): void {
    this.principal += amount;
    this._elapsedDays = 0;
    this._isMatured = false;
  }

  /** 持有期推进 */
  advanceDays(days: number): void {
    if (this._isMatured) return;
    this._elapsedDays += days;
    if (this._elapsedDays >= this._termDays) {
      this._isMatured = true;
    }
  }

  get isMatured(): boolean {
    return this._isMatured;
  }

  /** 到期兑付 */
  redeem(): number {
    if (!this._isMatured) return 0;
    const value = this.principal * (1 + this._rate * (this._termDays / 365));
    this.principal = 0;
    return value;
  }

  get currentValue(): number {
    if (!this._isMatured) return this.principal;
    return this.principal * (1 + this._rate * (this._termDays / 365));
  }

  get totalReturn(): number {
    return this.currentValue - this.principal;
  }

  get returnRate(): number {
    return this.principal > 0 ? this.totalReturn / this.principal : 0;
  }

  toHolding(): AssetHolding {
    return {
      type: this.type,
      principal: this.principal,
      currentValue: this.currentValue,
      totalReturn: this.totalReturn,
      returnRate: this.returnRate,
      detail: {
        rate: this._rate,
        termDays: this._termDays,
        elapsedDays: this._elapsedDays,
        isMatured: this._isMatured,
      },
    };
  }
}

/** 基金产品 */
export class Fund {
  readonly type: AssetType = 'fund';
  shares: number = 0;
  nav: number = 1.0;
  private _totalInvested: number = 0;

  /** 买入 */
  buy(amount: number): number {
    const share = amount / this.nav;
    this.shares += share;
    this._totalInvested += amount;
    return share;
  }

  /** 卖出 */
  sell(shares: number): number {
    const actual = Math.min(shares, this.shares);
    if (actual <= 0) return 0;
    const amount = actual * this.nav;
    // 成本基数按卖出份额比例冲减，避免收益率虚低
    this._totalInvested = Math.max(
      0,
      this._totalInvested * (1 - actual / this.shares),
    );
    this.shares -= actual;
    return amount;
  }

  /** 更新净值 */
  updateNav(newNav: number): void {
    this.nav = newNav;
  }

  get currentValue(): number {
    return this.shares * this.nav;
  }

  get totalReturn(): number {
    return this.currentValue - this._totalInvested;
  }

  get returnRate(): number {
    return this._totalInvested > 0 ? this.totalReturn / this._totalInvested : 0;
  }

  toHolding(): AssetHolding {
    return {
      type: this.type,
      principal: this._totalInvested,
      currentValue: this.currentValue,
      totalReturn: this.totalReturn,
      returnRate: this.returnRate,
      detail: { shares: this.shares, nav: this.nav },
    };
  }
}

/** 玩家投资组合 */
export class PlayerPortfolio {
  deposit: DepositAccount;
  cashMgmt: CashManagement;
  closedFund: ClosedEndFund;
  fund: Fund;
  cash: number;

  /** 期初本金（用于收益口径） */
  readonly initialPrincipal: number;

  constructor(
    depositRate: number,
    closedRate: number,
    closedTerm: number,
    initialCash: number,
  ) {
    this.deposit = new DepositAccount(depositRate);
    this.cashMgmt = new CashManagement();
    this.closedFund = new ClosedEndFund(closedRate, closedTerm);
    this.fund = new Fund();
    this.cash = initialCash;
    this.initialPrincipal = initialCash;
  }

  /** 总资产 */
  get totalAssets(): number {
    return (
      this.cash +
      this.deposit.principal +
      this.cashMgmt.currentValue +
      this.closedFund.currentValue +
      this.fund.currentValue
    );
  }

  /** 总收益 */
  get totalReturn(): number {
    return this.totalAssets - this.initialPrincipal;
  }

  /** 总收益率 */
  get totalReturnRate(): number {
    return this.initialPrincipal > 0
      ? this.totalReturn / this.initialPrincipal
      : 0;
  }

  getAllHoldings(): AssetHolding[] {
    return [
      { ...this.deposit.toHolding(), type: 'deposit' as AssetType },
      { ...this.cashMgmt.toHolding(), type: 'cash_mgmt' as AssetType },
      { ...this.closedFund.toHolding(), type: 'closed_fund' as AssetType },
      { ...this.fund.toHolding(), type: 'fund' as AssetType },
    ];
  }
}
