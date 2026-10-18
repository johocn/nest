import {
  GameConfig,
  SliceInfo,
  SliceStatus,
  MarketDataItem,
} from '../config/GameConfig';
import { TradingStateMachine } from './TradingStateMachine';

export type SliceTickCallback = (info: SliceInfo, progress: number) => void;
export type DayCompleteCallback = (dayInfo: {
  date: string;
  slicesCompleted: number;
  totalSlices: number;
}) => void;
export type HolidayCallback = (date: string) => void;

/** 52切片时间轴引擎 - 驱动虚拟交易日 */
export class TimeSliceEngine {
  private _slices: SliceInfo[] = [];
  private _currentSliceIndex: number = -1;
  private _stateMachine: TradingStateMachine;
  private _isRunning: boolean = false;
  private _isPaused: boolean = false;
  private _stopped: boolean = false;
  private _speed: number = 1;
  private _timerId: ReturnType<typeof setTimeout> | null = null;
  private _currentDate: string = '';
  private _dateIndex: number = 0;
  private _marketData: MarketDataItem[] = [];

  // 回调（多播：UI 与核心逻辑各自注册互不覆盖）
  private _sliceTickCbs: SliceTickCallback[] = [];
  private _dayCompleteCbs: DayCompleteCallback[] = [];
  private _holidayCbs: HolidayCallback[] = [];

  constructor(stateMachine: TradingStateMachine) {
    this._stateMachine = stateMachine;
  }

  get currentSliceIndex(): number {
    return this._currentSliceIndex;
  }

  get currentDate(): string {
    return this._currentDate;
  }

  get slices(): readonly SliceInfo[] {
    return this._slices;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  /** 是否处于暂停 */
  get isPaused(): boolean {
    return this._isPaused;
  }

  /** 当前速度倍率 */
  get speed(): number {
    return this._speed;
  }

  get totalSlices(): number {
    return GameConfig.SLICES_PER_DAY;
  }

  /** 设置速度倍率（0.5x ~ 10x） */
  setSpeed(multiplier: number): void {
    this._speed = Math.max(
      GameConfig.MIN_SPEED,
      Math.min(GameConfig.MAX_SPEED, multiplier),
    );
  }

  /** 暂停（切片停在当前位置，不改变运行状态） */
  pause(): void {
    this._isPaused = true;
  }

  /** 继续 */
  resume(): void {
    this._isPaused = false;
  }

  /** 设置市场数据 */
  setMarketData(data: MarketDataItem[]): void {
    this._marketData = data;
  }

  /** 注册休市回调（可多个） */
  onHoliday(cb: HolidayCallback): void {
    this._holidayCbs.push(cb);
  }

  /** 注册切片回调（可多个） */
  onSliceTick(cb: SliceTickCallback): void {
    this._sliceTickCbs.push(cb);
  }

  /** 注册日完成回调（可多个） */
  onDayComplete(cb: DayCompleteCallback): void {
    this._dayCompleteCbs.push(cb);
  }

  private _emitSlice(slice: SliceInfo, progress: number): void {
    for (const cb of this._sliceTickCbs) {
      try {
        cb(slice, progress);
      } catch (e) {
        console.error('[TimeSliceEngine] sliceTick listener error:', e);
      }
    }
  }

  private _emitDayComplete(info: {
    date: string;
    slicesCompleted: number;
    totalSlices: number;
  }): void {
    for (const cb of this._dayCompleteCbs) {
      try {
        cb(info);
      } catch (e) {
        console.error('[TimeSliceEngine] dayComplete listener error:', e);
      }
    }
  }

  private _emitHoliday(date: string): void {
    for (const cb of this._holidayCbs) {
      try {
        cb(date);
      } catch (e) {
        console.error('[TimeSliceEngine] holiday listener error:', e);
      }
    }
  }

  /** 启动一个虚拟交易日 */
  async startTradingDay(dateIndex: number): Promise<void> {
    if (this._isRunning) {
      console.warn('[TimeSliceEngine] 引擎已在运行中');
      return;
    }

    if (this._marketData.length === 0) {
      console.error('[TimeSliceEngine] 无市场数据');
      return;
    }

    this._stopped = false;
    this._dateIndex = dateIndex % this._marketData.length;
    const dayData = this._marketData[this._dateIndex];
    this._currentDate = dayData.date;

    // 检查是否休市日
    if (!dayData.isTradingDay) {
      this._stateMachine.transition('holiday', `休市日: ${this._currentDate}`);
      this._emitHoliday(this._currentDate);
      return;
    }

    // 预开盘
    this._stateMachine.transition('pre_open', `预开盘: ${this._currentDate}`);

    // 初始化52切片
    this._initSlices(dayData);
    this._currentSliceIndex = 0;
    this._isRunning = true;

    // 开盘交易
    this._stateMachine.transition('trading', `开盘交易: ${this._currentDate}`);

    // 开始执行切片
    await this._executeSlices();
  }

  /** 等待（可被 stop 中断、可被 pause 挂起）
   * @param ms 名义等待时长（会按速度倍率缩放）
   * @returns 是否被 stop 中断
   */
  async waitScaled(ms: number): Promise<boolean> {
    const total = Math.max(0, ms / this._speed);
    const step = 40;
    let waited = 0;
    while (waited < total) {
      if (this._stopped) return false;
      if (this._isPaused) {
        await new Promise<void>((resolve) => {
          this._timerId = setTimeout(resolve, 60);
        });
        continue;
      }
      const chunk = Math.min(step, total - waited);
      await new Promise<void>((resolve) => {
        this._timerId = setTimeout(resolve, chunk);
      });
      waited += chunk;
    }
    return !this._stopped;
  }

  /** 停止引擎 */
  stop(): void {
    this._isRunning = false;
    this._isPaused = false;
    this._stopped = true;
    if (this._timerId !== null) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  /** 重置引擎 */
  reset(): void {
    this.stop();
    this._slices = [];
    this._currentSliceIndex = -1;
    this._currentDate = '';
    this._stateMachine.reset();
  }

  /** 获取当前切片是否被停牌 */
  isCurrentSliceSuspended(): boolean {
    if (
      this._currentSliceIndex < 0 ||
      this._currentSliceIndex >= this._slices.length
    ) {
      return false;
    }
    return this._slices[this._currentSliceIndex].isSuspended;
  }

  /** 获取当前切片数据 */
  getCurrentSlice(): SliceInfo | null {
    if (
      this._currentSliceIndex < 0 ||
      this._currentSliceIndex >= this._slices.length
    ) {
      return null;
    }
    return this._slices[this._currentSliceIndex];
  }

  private _initSlices(dayData: MarketDataItem): void {
    const baseTime = new Date(dayData.date).getTime();
    this._slices = Array.from(
      { length: GameConfig.SLICES_PER_DAY },
      (_, i) => ({
        index: i,
        status: 'pending' as SliceStatus,
        timestamp: baseTime + i * GameConfig.SIM_MINUTES_PER_SLICE * 60 * 1000, // 模拟盘内时间推进
        isSuspended: dayData.suspendedSlices.includes(i),
      }),
    );
  }

  private async _executeSlices(): Promise<void> {
    while (
      this._isRunning &&
      this._currentSliceIndex < GameConfig.SLICES_PER_DAY
    ) {
      const slice = this._slices[this._currentSliceIndex];

      // 处理临时停牌
      if (slice.isSuspended) {
        this._stateMachine.transition(
          'suspended',
          `切片 ${slice.index + 1}/${GameConfig.SLICES_PER_DAY} 临时停牌`,
        );
        this._stateMachine.incrementPaused();
        slice.status = 'suspended';
        this._emitSlice(slice, this._getProgress());

        // 停牌切片跳过交易，但时间轴继续
        this._stateMachine.transition(
          'trading',
          `切片 ${slice.index + 1} 恢复交易`,
        );
        this._currentSliceIndex++;
        continue;
      }

      // 正常交易切片
      slice.status = 'running';
      this._emitSlice(slice, this._getProgress());

      // 等待切片时长（受速度倍率与暂停影响）
      const alive = await this.waitScaled(GameConfig.SLICE_DURATION_MS);
      if (!alive) return; // 被 stop() 中断

      slice.status = 'completed';
      this._emitSlice(slice, this._getProgress());

      this._currentSliceIndex++;
    }

    // 全部52切片执行完毕 → 强制封盘
    if (this._currentSliceIndex >= GameConfig.SLICES_PER_DAY) {
      this._isRunning = false;
      this._stateMachine.transition(
        'forced_close',
        `封盘: ${this._currentDate} 全部${GameConfig.SLICES_PER_DAY}切片执行完毕`,
      );
      this._stateMachine.transition(
        'settlement',
        `资产清算: ${this._currentDate}`,
      );

      this._emitDayComplete({
        date: this._currentDate,
        slicesCompleted: GameConfig.SLICES_PER_DAY,
        totalSlices: GameConfig.SLICES_PER_DAY,
      });
    }
  }

  private _getProgress(): number {
    return (this._currentSliceIndex + 1) / GameConfig.SLICES_PER_DAY;
  }
}
