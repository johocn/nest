import { AsyncLocalStorage } from 'async_hooks';

/** 单个 Span —— 追踪一个操作的耗时 + 事件 + 错误 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, any>;
}

export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly kind: 'server' | 'internal' | 'client';
  readonly attributes: Record<string, any> = {};
  readonly events: SpanEvent[] = [];

  private _startTime: number;
  private _endTime: number | null = null;
  private _status: 'ok' | 'error' = 'ok';
  private _errorMessage: string | null = null;

  constructor(opts: {
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    name: string;
    kind?: 'server' | 'internal' | 'client';
    attributes?: Record<string, any>;
  }) {
    this.traceId = opts.traceId;
    this.spanId = opts.spanId;
    this.parentSpanId = opts.parentSpanId;
    this.name = opts.name;
    this.kind = opts.kind ?? 'internal';
    if (opts.attributes) Object.assign(this.attributes, opts.attributes);
    this._startTime = performance.now();
  }

  setAttribute(key: string, value: any): this {
    this.attributes[key] = value;
    return this;
  }

  addEvent(name: string, attributes?: Record<string, any>): this {
    this.events.push({ name, timestamp: performance.now(), attributes });
    return this;
  }

  recordError(err: Error): this {
    this._status = 'error';
    this._errorMessage = err.message;
    this.setAttribute('error.message', err.message);
    return this;
  }

  end(): void {
    if (this._endTime !== null) return;
    this._endTime = performance.now();
  }

  /** ms */
  get duration(): number {
    const end = this._endTime ?? performance.now();
    return end - this._startTime;
  }

  get status(): string { return this._status; }
  get errorMessage(): string | null { return this._errorMessage; }
  get startTime(): number { return this._startTime; }
  get endTime(): number | null { return this._endTime; }

  toJSON(): Record<string, any> {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      status: this._status,
      errorMessage: this._errorMessage,
      startTime: Math.round(this._startTime * 1000) / 1000,
      duration: Math.round(this.duration * 1000) / 1000,
      attributes: this.attributes,
      events: this.events,
    };
  }
}

/** 单条 trace = 一个请求的所有 span */
export interface TraceRecord {
  traceId: string;
  rootSpanId: string;
  spans: Span[];
  createdAt: number;
}

interface TraceContext {
  traceId: string;
  currentSpan: Span;
  allSpans: Span[];
  startedAt: number;
}

function genId(len = 12): string {
  const full = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return full.slice(0, Math.max(len, 4));
}

export function genTraceId(): string { return genId(24); }
export function genSpanId(): string { return genId(12); }

/**
 * TraceService —— 全链路追踪核心（零外部依赖，AsyncLocalStorage 传递 context）
 *
 * 典型使用（Middleware 层）：
 *   const root = traceService.startRootSpan('HTTP POST /api/...', { method, url });
 *   traceService.runWithContext(root, () => next());
 *   // 在 finally 里 traceService.endTrace();
 *
 * Service 层：
 *   const span = traceService.startSpan('buff.apply', { buffId });
 *   span.addEvent('hit', { playerId });
 *   span.end();
 */
export class TraceService {
  /** AsyncLocalStorage —— 唯一全局实例 */
  private readonly _als = new AsyncLocalStorage<TraceContext>();

  /** Ring buffer：最近 200 条 trace */
  private readonly RING_MAX = 200;
  private readonly _ring: TraceRecord[] = [];

  readonly enabled: boolean;

  constructor() {
    this.enabled = process.env.TRACE_ENABLED !== 'false';
  }

  // ===== Context API =====

  get currentSpan(): Span | null {
    return this._als.getStore()?.currentSpan ?? null;
  }

  get traceId(): string | null {
    return this._als.getStore()?.traceId ?? null;
  }

  /** 在 root span 的 context 里执行 fn（Middleware 调用） */
  runWithContext<T>(root: Span, fn: () => T): T {
    const ctx: TraceContext = {
      traceId: root.traceId,
      currentSpan: root,
      allSpans: [root],
      startedAt: Date.now(),
    };
    return this._als.run(ctx, fn);
  }

  // ===== Span API =====

  startRootSpan(name: string, attributes?: Record<string, any>, existingTraceId?: string): Span {
    return new Span({
      traceId: existingTraceId ?? genTraceId(),
      spanId: genSpanId(),
      parentSpanId: null,
      name,
      kind: 'server',
      attributes,
    });
  }

  startSpan(name: string, attributes?: Record<string, any>): Span {
    const store = this._als.getStore();
    if (!store || !this.enabled) {
      // 无 context → 返回一个立即 end 的 dummy span（零开销，调用方照常 .end() 不报错）
      const dummy = new Span({
        traceId: '000000',
        spanId: '0000',
        parentSpanId: null,
        name,
        kind: 'internal',
        attributes,
      });
      dummy.end();
      return dummy;
    }
    const span = new Span({
      traceId: store.traceId,
      spanId: genSpanId(),
      parentSpanId: store.currentSpan.spanId,
      name,
      kind: 'internal',
      attributes,
    });
    store.allSpans.push(span);
    store.currentSpan = span;
    return span;
  }

  endSpan(span: Span): void {
    span.end();
    const store = this._als.getStore();
    if (store) {
      const parent = store.allSpans.find((s) => s.spanId === span.parentSpanId);
      if (parent) store.currentSpan = parent;
    }
  }

  /** 结束整条 trace —— 在请求出口 / finally 里调 */
  endTrace(): void {
    const store = this._als.getStore();
    if (!store) return;
    store.currentSpan.end();

    const trace: TraceRecord = {
      traceId: store.traceId,
      rootSpanId: store.allSpans[0]?.spanId ?? '',
      spans: store.allSpans,
      createdAt: store.startedAt,
    };
    this._ring.push(trace);
    if (this._ring.length > this.RING_MAX) this._ring.shift();
  }

  // ===== 查询 =====

  listRecent(limit = 20): TraceRecord[] {
    return this._ring.slice(-Math.min(limit, this._ring.length));
  }

  find(traceId: string): TraceRecord | null {
    return this._ring.find((t) => t.traceId === traceId) ?? null;
  }

  clear(): void { this._ring.length = 0; }
}

/** 全局单例（NestJS Module 注册 provider 时再包一层） */
export const traceService = new TraceService();
