import { GameConfig, SliceInfo, SliceStatus, MarketDataItem } from '../config/GameConfig';
import { TradingStateMachine } from './TradingStateMachine';

export type SliceTickCallback = (info: SliceInfo, progress: number) => void;
export type DayCompleteCallback = (dayInfo: { date: string; slicesCompleted: number; totalSlices: number }) => void;
export type HolidayCallback = (date: string) => void;

/** 52切片时间轴引擎 - 驱动虚拟交易日 */
export class TimeSliceEngine {
  private _slices: SliceInfo[] = [];
  private _currentSliceIndex: number = -1;
  private _stateMachine: TradingStateMachine;
  private _isRunning: boolean = false;
  private _timerId: ReturnType<typeof setTimeout> | null = null;
  private _currentDate: string = '';
  private _dateIndex: number = 0;
  private _marketData: MarketDataItem[] = [];

  // 回调
  private _onSliceTick: SliceTickCallback | null = null;
  private _onDayComplete: DayCompleteCallback | null = null;
  private _onHoliday: HolidayCallback | null = null;

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

  get totalSlices(): number {
    return GameConfig.SLICES_PER_DAY;
  }

  /** 设置市场数据 */
  setMarketData(data: MarketDataItem[]): void {
    this._marketData = data;
  }

  /** 注册休市回调 */
  onHoliday(cb: HolidayCallback): void {
    this._onHoliday = cb;
  }

  /** 注册切片回调 */
  onSliceTick(cb: SliceTickCallback): void {
    this._onSliceTick = cb;
  }

  /** 注册日完成回调 */
  onDayComplete(cb: DayCompleteCallback): void {
    this._onDayComplete = cb;
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

    this._dateIndex = dateIndex % this._marketData.length;
    const dayData = this._marketData[this._dateIndex];
    this._currentDate = dayData.date;

    // 检查是否休市日
    if (!dayData.isTradingDay) {
      this._stateMachine.transition('holiday', `休市日: ${this._currentDate}`);
      this._onHoliday?.(this._currentDate);
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

  /** 停止引擎 */
  stop(): void {
    this._isRunning = false;
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
    if (this._currentSliceIndex < 0 || this._currentSliceIndex >= this._slices.length) {
      return false;
    }
    return this._slices[this._currentSliceIndex].isSuspended;
  }

  /** 获取当前切片数据 */
  getCurrentSlice(): SliceInfo | null {
    if (this._currentSliceIndex < 0 || this._currentSliceIndex >= this._slices.length) {
      return null;
    }
    return this._slices[this._currentSliceIndex];
  }

  private _initSlices(dayData: MarketDataItem): void {
    const baseTime = new Date(dayData.date).getTime();
    this._slices = Array.from({ length: GameConfig.SLICES_PER_DAY }, (_, i) => ({
      index: i,
      status: 'pending' as SliceStatus,
      timestamp: baseTime + i * (GameConfig.SLICE_DURATION_MS * 60), // 模拟真实时间推进
      isSuspended: dayData.suspendedSlices.includes(i),
    }));
  }

  private async _executeSlices(): Promise<void> {
    while (this._isRunning && this._currentSliceIndex < GameConfig.SLICES_PER_DAY) {
      const slice = this._slices[this._currentSliceIndex];

      // 处理临时停牌
      if (slice.isSuspended) {
        this._stateMachine.transition('suspended', `切片 ${slice.index + 1}/${GameConfig.SLICES_PER_DAY} 临时停牌`);
        this._stateMachine.incrementPaused();
        slice.status = 'suspended';
        this._onSliceTick?.(slice, this._getProgress());

        // 停牌切片跳过交易，但时间轴继续
        this._stateMachine.transition('trading', `切片 ${slice.index + 1} 恢复交易`);
        this._currentSliceIndex++;
        continue;
      }

      // 正常交易切片
      slice.status = 'running';
      this._onSliceTick?.(slice, this._getProgress());

      // 等待切片时长
      await this._wait(GameConfig.SLICE_DURATION_MS);

      slice.status = 'completed';
      this._onSliceTick?.(slice, this._getProgress());

      this._currentSliceIndex++;
    }

    // 全部52切片执行完毕 → 强制封盘
    if (this._currentSliceIndex >= GameConfig.SLICES_PER_DAY) {
      this._isRunning = false;
      this._stateMachine.transition('forced_close', `封盘: ${this._currentDate} 全部${GameConfig.SLICES_PER_DAY}切片执行完毕`);
      this._stateMachine.transition('settlement', `资产清算: ${this._currentDate}`);

      this._onDayComplete?.({
        date: this._currentDate,
        slicesCompleted: GameConfig.SLICES_PER_DAY,
        totalSlices: GameConfig.SLICES_PER_DAY,
      });
    }
  }

  private _getProgress(): number {
    return (this._currentSliceIndex + 1) / GameConfig.SLICES_PER_DAY;
  }

  private _wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      this._timerId = setTimeout(resolve, ms);
    });
  }
}