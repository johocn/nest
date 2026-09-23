/**
 * 小游戏 WebSocket 适配（S7 Task 2 Step 2）。
 *
 * 为何需要：小游戏没有浏览器 WebSocket，只有 `wx.connectSocket`，而 socket.io 的
 * websocket transport 直接用 `new WebSocket(url, protocols)` 建连 —— 本模块把
 * wx 的 SocketTask 包成 WebSocket 兼容对象，注入 globalThis 供引擎使用。
 *
 * wx 与浏览器 WebSocket 的差异（本模块逐一抹平）：
 *  1) wx 只有 SocketTask 的 onOpen/onMessage/onClose/onError（只能订阅），而 socket.io /
 *     engine.io 各版本分别用过 `ws.onopen = …` 与 `addEventListener('open', …)` 两种风格，
 *     故两种都要分发。
 *  2) wx 的 message 事件是 `{ data }`，字符串消息与浏览器一致，直接透传（不 JSON.parse）。
 *  3) wx 的 close 事件是 `{ code, reason }`，没有 wasClean；这里按 `code === 1000` 推导。
 *  4) wx 的 error 事件只有 `{ errMsg }`，浏览器是 Event；这里构造 Error 并把 errMsg 放进 message。
 *  5) wx 在连接建立前 close() 之后不再回调 onClose，故未 OPEN 时直接切 CLOSED 并补一次 close 事件。
 *  6) 常量与 readyState 数值对齐浏览器（CONNECTING=0 / OPEN=1 / CLOSING=2 / CLOSED=3）。
 *
 * 顶层不触碰 wx（只声明函数），无引擎依赖。
 */

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/** wx.connectSocket 的可选参数（header / timeout 暂由调用方按需传入） */
export interface WxSocketConnectOptions {
  header?: Record<string, string>;
  timeout?: number;
}

/** 构造器类型：与浏览器 WebSocket 的调用形态对齐 */
export type WxWebSocketCtor = {
  new (url: string, protocols?: string | string[], opts?: WxSocketConnectOptions): any;
};

/** 小游戏全局对象（与 Platform.ts 内同名私有函数同判定口径，两处互不依赖） */
function wxApi(): any {
  const w = (globalThis as any).wx;
  return w && typeof w === 'object' ? w : null;
}

/** 回调调用一律 try/catch：socket.io 的回调抛错不得抛回 wx 的事件队列 */
function safeCall(fn: any, arg?: any): void {
  if (typeof fn !== 'function') return;
  try {
    fn(arg);
  } catch (e) {
    console.warn('[S7] wx-socket 回调抛错（已吞掉，避免污染 wx 事件队列）', e);
  }
}

export function createWxWebSocket(): WxWebSocketCtor {
  function WxWebSocket(this: any, url: string, protocols?: string | string[], opts?: WxSocketConnectOptions) {
    this.url = url;
    this.protocol = '';
    this.binaryType = 'arraybuffer';
    this.bufferedAmount = 0;
    this.readyState = CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._listeners = { open: [], message: [], close: [], error: [] };
    this._closeEmitted = false;
    this._task = null;

    const wx = wxApi();
    const failed = (msg: string) => {
      this.readyState = CLOSED;
      setTimeout(() => {
        this._emit('error', new Error(msg));
        this._finishClose({ code: 1006, reason: msg, wasClean: false });
      }, 0);
    };

    if (!wx || typeof wx.connectSocket !== 'function') {
      failed('wx.connectSocket 不可用');
      return;
    }

    const task = wx.connectSocket({
      url,
      protocols,
      header: opts && opts.header,
      timeout: opts && opts.timeout,
    });
    if (!task || typeof task.onOpen !== 'function') {
      failed('wx.connectSocket 未返回 SocketTask');
      return;
    }
    this._task = task;
    if (typeof task.protocol === 'string') this.protocol = task.protocol;

    task.onOpen(() => {
      this.readyState = OPEN;
      this._emit('open', { type: 'open' });
    });
    task.onMessage((res: any) => {
      this._emit('message', { type: 'message', data: res ? res.data : undefined });
    });
    task.onClose((res: any) => {
      const code = res && typeof res.code === 'number' ? res.code : 1006;
      this._finishClose({ code, reason: (res && res.reason) || '', wasClean: code === 1000 });
    });
    task.onError((err: any) => {
      this._emit('error', new Error((err && err.errMsg) || 'wx socket error'));
    });
  }

  const proto: any = WxWebSocket.prototype;

  proto.send = function (this: any, data: any): void {
    if (this.readyState !== OPEN || !this._task) {
      // 浏览器语义是抛 InvalidStateError，但 socket.io 的发送路径不应因此崩溃 → 记日志丢弃
      console.warn('[S7] wx-socket 尚未 OPEN，send 被忽略');
      return;
    }
    try {
      // 字符串直接透传，非字符串原样交给 wx（不做转换）
      this._task.send({ data, fail: (err: any) => console.warn('[S7] wx-socket send 失败', err) });
    } catch (e) {
      console.warn('[S7] wx-socket send 异常', e);
    }
  };

  proto.close = function (this: any, code?: number, reason?: string): void {
    if (this.readyState === CLOSED) return;
    const wasConnecting = this.readyState === CONNECTING;
    this.readyState = CLOSING;
    if (this._task && typeof this._task.close === 'function') {
      try {
        this._task.close({ code, reason });
      } catch (e) {
        console.warn('[S7] wx-socket close 异常', e);
      }
    }
    if (wasConnecting || !this._task) {
      this._finishClose({ code: code === undefined ? 1000 : code, reason: reason || '', wasClean: false });
    }
  };

  proto.addEventListener = function (this: any, type: string, fn: any): void {
    const arr = this._listeners[type];
    if (arr && typeof fn === 'function' && arr.indexOf(fn) < 0) arr.push(fn);
  };

  proto.removeEventListener = function (this: any, type: string, fn: any): void {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };

  /** 同时分发属性式回调与 addEventListener 监听（引擎两种风格都用过） */
  proto._emit = function (this: any, type: string, event: any): void {
    safeCall(this['on' + type], event);
    const arr = this._listeners[type] || [];
    for (let i = 0; i < arr.length; i++) safeCall(arr[i], event);
  };

  /** close 事件只发一次（wx onClose 与本地 close() 可能先后到达） */
  proto._finishClose = function (this: any, event: any): void {
    if (this._closeEmitted) return;
    this._closeEmitted = true;
    this.readyState = CLOSED;
    this._emit('close', event);
  };

  (WxWebSocket as any).CONNECTING = CONNECTING;
  (WxWebSocket as any).OPEN = OPEN;
  (WxWebSocket as any).CLOSING = CLOSING;
  (WxWebSocket as any).CLOSED = CLOSED;
  proto.CONNECTING = CONNECTING;
  proto.OPEN = OPEN;
  proto.CLOSING = CLOSING;
  proto.CLOSED = CLOSED;

  return WxWebSocket as any as WxWebSocketCtor;
}

/** 幂等注入：仅当 globalThis.WebSocket 未定义时才替换，避免覆盖 H5 / 开发者工具自带的实现 */
export function ensureWxWebSocket(): void {
  const g = globalThis as any;
  if (typeof g.WebSocket !== 'undefined') return;
  g.WebSocket = createWxWebSocket();
}

/**
 * 加载期兜底：socket.io 的 websocket transport 在**脚本求值期**就捕获了 WebSocket 构造器
 * （vendor/socket.io.min.js 内 `rt=L.WebSocket||L.MozWebSocket`），所以注入必须早于
 * socket.io.min.js。当打包/加载顺序不由本模块控制时，可在更早的普通脚本里调用这个全局名。
 */
(globalThis as any).__S7_WX_SOCKET__ = { ensureWxWebSocket, createWxWebSocket };