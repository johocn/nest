import { GameConfig, MarketDataItem } from '../config/GameConfig';

/** 可复现随机数（mulberry32） */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成法定节假日集合（简化版：元旦 / 春节 / 五一 / 国庆） */
function buildHolidays(): Set<string> {
  const holidays = new Set<string>();
  const addRange = (year: number, month: number, day: number, days: number) => {
    for (let i = 0; i < days; i++) {
      const d = new Date(year, month - 1, day + i);
      holidays.add(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      );
    }
  };
  for (let y = 2022; y <= 2026; y++) {
    addRange(y, 1, 1, 3); // 元旦
    addRange(y, 2, 1, 7); // 春节
    addRange(y, 5, 1, 3); // 五一
    addRange(y, 10, 1, 7); // 国庆
  }
  return holidays;
}

/** 按种子生成 2022-01-01 ~ 2026-07-01 的历史回放行情 */
export function generateMarketData(seed: number): MarketDataItem[] {
  const rng = createRng(seed);
  const holidays = buildHolidays();
  const start = new Date(GameConfig.DATA_START);
  const end = new Date(GameConfig.DATA_END);
  const data: MarketDataItem[] = [];
  let fundNav = 1.0;
  let closedFundNav = 1.0;

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const current = new Date(start);
  while (current <= end) {
    const dateStr = fmt(current);
    const dayOfWeek = current.getDay(); // 0=周日, 6=周六
    const isTradingDay =
      dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(dateStr);

    // 基金日涨跌（略偏涨，模拟长期权益资产）
    const fundChange = isTradingDay ? (rng() - 0.48) * 0.04 : 0;
    const closedChange = isTradingDay ? (rng() - 0.45) * 0.02 : 0;

    if (isTradingDay) {
      fundNav = Math.max(0.5, fundNav * (1 + fundChange));
      closedFundNav = Math.max(0.8, closedFundNav * (1 + closedChange));
    }

    // 现金理财收益率（缓慢波动）
    const cashMgmtRate = 0.025 + (rng() - 0.5) * 0.01;

    // 临时停牌切片（仅交易日，5% 概率）
    const suspendedSlices: number[] = [];
    if (isTradingDay && rng() < 0.05) {
      suspendedSlices.push(Math.floor(rng() * GameConfig.SLICES_PER_DAY));
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
  }

  return data;
}

/** 市场数据加载器（种子固定 → 行情可复现） */
export class MarketDataLoader {
  private _seed: number;
  private _data: MarketDataItem[] = [];
  private _currentIndex: number = 0;
  /** 回放起点索引（startDate 首个自然日，缺省 0） */
  private _startIndex = 0;
  private _startDate: string | null;

  constructor(
    seed: number = GameConfig.DEFAULT_SEED,
    startDate?: string,
    presetData?: MarketDataItem[],
  ) {
    this._seed = seed;
    // 支持注入后端行情（presetData 非空时优先使用，跳过本地生成）
    this._data =
      presetData && presetData.length ? presetData : generateMarketData(seed);
    this._startDate = startDate ?? null;
    if (startDate) {
      this._startIndex = this.indexOfDate(startDate);
      this._currentIndex = this._startIndex;
    }
  }

  /** 随机种子 */
  get seed(): number {
    return this._seed;
  }

  /** 回放起点索引 */
  get startIndex(): number {
    return this._startIndex;
  }

  /** 回放起点日期（未指定为 null） */
  get startDate(): string | null {
    return this._startDate;
  }

  /** 首个日期 >= date 的数据索引（找不到回落 0） */
  indexOfDate(date: string): number {
    const idx = this._data.findIndex((d) => d.date >= date);
    return idx < 0 ? 0 : idx;
  }

  /** 重设回放起点（仅应在开局前调用） */
  setStart(date: string): void {
    this._startDate = date;
    this._startIndex = this.indexOfDate(date);
    this._currentIndex = this._startIndex;
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
    this._currentIndex =
      ((index % this._data.length) + this._data.length) % this._data.length;
    return this._data[this._currentIndex];
  }

  /** 下一个自然日数据（循环） */
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
    } while (
      !this._data[this._currentIndex].isTradingDay &&
      attempts < this._data.length
    );
    return this._data[this._currentIndex];
  }

  /** 获取指定日期范围内的数据 */
  getRange(startIdx: number, count: number): MarketDataItem[] {
    const result: MarketDataItem[] = [];
    for (let i = 0; i < count; i++) {
      const idx =
        (((startIdx + i) % this._data.length) + this._data.length) %
        this._data.length;
      result.push(this._data[idx]);
    }
    return result;
  }

  /** 数据总数 */
  get totalDays(): number {
    return this._data.length;
  }

  /** 是否还有下一个自然日（未走到数据末尾） */
  hasNext(): boolean {
    return this._currentIndex < this._data.length - 1;
  }

  /** 数据回放是否走完 */
  get isFinished(): boolean {
    return this._currentIndex >= this._data.length - 1;
  }

  /** 重置到起点（含 startDate 偏移） */
  reset(): void {
    this._currentIndex = this._startIndex;
  }

  /**
   * 从后端 /api/sandbox/v1/market-data 拉取全量行情（分页聚合）。
   * 返回 MarketDataItem[]，可注入给构造函数以替换本地生成。
   * 失败抛出，由调用方决定是否回退到内置行情。
   */
  static async fetchMarketData(
    baseUrl: string = GameConfig.API_BASE,
  ): Promise<MarketDataItem[]> {
    const all: MarketDataItem[] = [];
    let page = 1;
    const pageSize = 200;
    for (;;) {
      const res = await fetch(
        `${baseUrl}/market-data?page=${page}&pageSize=${pageSize}`,
      );
      if (!res.ok) throw new Error(`market-data HTTP ${res.status}`);
      const json = (await res.json()) as {
        items?: MarketDataItem[];
        total?: number;
      };
      const items = json.items ?? [];
      all.push(...items);
      if (!items.length || all.length >= (json.total ?? 0)) break;
      page++;
    }
    if (!all.length) throw new Error('market-data 为空');
    return all;
  }
}
