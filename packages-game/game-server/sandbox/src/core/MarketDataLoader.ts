import { GameConfig, MarketDataItem } from '../config/GameConfig';

/** 模拟市场数据 - 2022-01-01 ~ 2026-07-01 真实历史数据回放 */
const MOCK_MARKET_DATA: MarketDataItem[] = generateMockData();

function generateMockData(): MarketDataItem[] {
  const start = new Date('2022-01-01');
  const end = new Date('2026-07-01');
  const data: MarketDataItem[] = [];
  let fundNav = 1.0;
  let closedFundNav = 1.0;

  // 法定节假日（简化版）
  const holidays = new Set<string>();
  const addHolidayRange = (year: number, month: number, day: number, days: number) => {
    for (let i = 0; i < days; i++) {
      const d = new Date(year, month - 1, day + i);
      holidays.add(d.toISOString().slice(0, 10));
    }
  };
  // 2022-2026 春节、国庆等
  for (const y of [2022, 2023, 2024, 2025, 2026]) {
    // 春节（约2月）
    addHolidayRange(y, 1, 31, 7);
    addHolidayRange(y, 2, 1, 7);
    // 国庆
    addHolidayRange(y, 10, 1, 7);
    // 五一
    addHolidayRange(y, 5, 1, 3);
    // 元旦
    addHolidayRange(y, 1, 1, 3);
  }

  const current = new Date(start);
  let dayIndex = 0;

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    const dayOfWeek = current.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = holidays.has(dateStr);
    const isTradingDay = !isWeekend && !isHoliday;

    // 随机涨跌
    const fundChange = isTradingDay ? (Math.random() - 0.48) * 0.04 : 0; // 略偏涨
    const closedChange = isTradingDay ? (Math.random() - 0.45) * 0.02 : 0;

    fundNav = Math.max(0.5, fundNav * (1 + fundChange));
    closedFundNav = Math.max(0.8, closedFundNav * (1 + closedChange));

    // 现金理财收益率（缓慢波动）
    const cashMgmtRate = 0.025 + (Math.random() - 0.5) * 0.01;

    // 随机停牌切片（仅交易日）
    const suspendedSlices: number[] = [];
    if (isTradingDay && Math.random() < 0.05) {
      // 5%概率出现临时停牌
      const sliceIdx = Math.floor(Math.random() * 52);
      suspendedSlices.push(sliceIdx);
    }

    data.push({
      date: dateStr,
      fundNav: Math.round(fundNav * 10000) / 10000,
      cashMgmtRate: Math.round(cashMgmtRate * 10000) / 10000,
      closedFundNav: Math.round(closedFundNav * 10000) / 10000,
      isTradingDay,
      suspendedSlices,
    });

    current.setDate(current.getDate() + 1);
    dayIndex++;
  }

  return data;
}

/** 市场数据加载器 */
export class MarketDataLoader {
  private _data: MarketDataItem[] = [];
  private _currentIndex: number = 0;

  constructor() {
    this._data = [...MOCK_MARKET_DATA];
  }

  /** 获取所有数据 */
  getAll(): MarketDataItem[] {
    return this._data;
  }

  /** 获取当前索引 */
  get currentIndex(): number {
    return this._currentIndex;
  }

  /** 获取当天的数据 */
  getCurrentDay(): MarketDataItem | null {
    return this._data[this._currentIndex] ?? null;
  }

  /** 跳转到指定日期（按索引，循环） */
  seekTo(index: number): MarketDataItem {
    this._currentIndex = index % this._data.length;
    return this._data[this._currentIndex];
  }

  /** 下一个交易日数据 */
  nextDay(): MarketDataItem {
    this._currentIndex = (this._currentIndex + 1) % this._data.length;
    return this._data[this._currentIndex];
  }

  /** 获取下一个交易日（跳过休市） */
  nextTradingDay(): MarketDataItem {
    let attempts = 0;
    do {
      this._currentIndex = (this._currentIndex + 1) % this._data.length;
      attempts++;
    } while (!this._data[this._currentIndex].isTradingDay && attempts < this._data.length);
    return this._data[this._currentIndex];
  }

  /** 获取指定日期范围内的数据 */
  getRange(startIdx: number, count: number): MarketDataItem[] {
    const result: MarketDataItem[] = [];
    for (let i = 0; i < count; i++) {
      const idx = (startIdx + i) % this._data.length;
      result.push(this._data[idx]);
    }
    return result;
  }

  /** 数据总数 */
  get totalDays(): number {
    return this._data.length;
  }

  /** 重置到起点 */
  reset(): void {
    this._currentIndex = 0;
  }
}