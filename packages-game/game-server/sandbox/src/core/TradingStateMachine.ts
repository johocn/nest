import { TradingPhase } from '../config/GameConfig';

export type StateTransition = {
  from: TradingPhase;
  to: TradingPhase;
  reason: string;
  timestamp: number;
};

export type StateListener = (transition: StateTransition) => void;

/** 交易状态机 - 控制沙盘交易生命周期 */
export class TradingStateMachine {
  private _current: TradingPhase = 'idle';
  private _history: StateTransition[] = [];
  private _listeners: StateListener[] = [];
  private _pausedSlices: number = 0;

  get current(): TradingPhase {
    return this._current;
  }

  get history(): readonly StateTransition[] {
    return this._history;
  }

  get pausedSlices(): number {
    return this._pausedSlices;
  }

  /** 当前是否可交易 */
  get isTradable(): boolean {
    return this._current === 'trading';
  }

  /** 当前是否可申购/赎回（基金+现金理财） */
  get isSubscribable(): boolean {
    return this._current === 'trading' || this._current === 'pre_open';
  }

  /** 当前是否封盘 */
  get isClosed(): boolean {
    return this._current === 'forced_close' || this._current === 'settlement';
  }

  /** 当前是否休市 */
  get isHoliday(): boolean {
    return this._current === 'holiday';
  }

  /** 尝试状态转移 */
  transition(to: TradingPhase, reason: string): boolean {
    if (!this._isValidTransition(this._current, to)) {
      console.warn(`[TradingStateMachine] 非法转移: ${this._current} -> ${to}`);
      return false;
    }

    const transition: StateTransition = {
      from: this._current,
      to,
      reason,
      timestamp: Date.now(),
    };

    this._current = to;
    this._history.push(transition);
    this._notify(transition);
    return true;
  }

  /** 切片暂停计数 */
  incrementPaused(): void {
    this._pausedSlices++;
  }

  resetPaused(): void {
    this._pausedSlices = 0;
  }

  /** 订阅状态变更 */
  subscribe(listener: StateListener): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }

  /** 重置状态机 */
  reset(): void {
    this._current = 'idle';
    this._pausedSlices = 0;
  }

  private _notify(t: StateTransition): void {
    for (const listener of this._listeners) {
      try {
        listener(t);
      } catch (e) {
        console.error('[TradingStateMachine] listener error:', e);
      }
    }
  }

  private _isValidTransition(from: TradingPhase, to: TradingPhase): boolean {
    const rules: Record<TradingPhase, TradingPhase[]> = {
      idle: ['pre_open', 'holiday'],
      pre_open: ['trading', 'holiday'],
      trading: ['suspended', 'forced_close', 'holiday'],
      suspended: ['trading', 'forced_close'],
      forced_close: ['settlement', 'holiday'],
      holiday: ['idle', 'pre_open', 'holiday'],
      settlement: ['idle', 'holiday'],
    };
    return rules[from]?.includes(to) ?? false;
  }
}