import { Platform } from '../platform/Platform';
import { ensureWxWebSocket } from '../platform/wx-socket';
import { bumpUp } from '../perf/counters';

export interface WsMessage {
  cmd: string;
  seq: number;
  code: number;
  msg: string;
  data: any;
}

interface Pending {
  resolve: (m: WsMessage) => void;
  reject: (e: Error) => void;
  timer: any;
}

const ACK_TIMEOUT_MS = 8000;

export class WsClient {
  private socket: any = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, (m: WsMessage) => void>();
  private readonly rawHandlers = new Map<string, (payload: any) => void>();

  async connect(token: string): Promise<void> {
    if (typeof io !== 'function') {
      throw new Error('socket.io 未加载：请确认 index.html 引入了 /vendor/socket.io.min.js');
    }
    if (Platform.isMiniGame()) ensureWxWebSocket();
    this.socket = io(Platform.env.wsUrl(), {
      transports: ['websocket'],
      query: { token },
      reconnection: true,
    });
    // onRaw 在 connect 前注册过的事件，connect 后补挂到 socket
    for (const [event, handler] of this.rawHandlers) this.socket.on(event, handler);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS 连接超时（8s）')), ACK_TIMEOUT_MS);
      this.socket.on('connect', () => {
        clearTimeout(timer);
        console.log('[S1] WS connected');
        resolve();
      });
      this.socket.on('connect_error', (err: any) => {
        clearTimeout(timer);
        reject(new Error(`WS 连接失败：${err?.message ?? err}`));
      });
    });

    this.socket.on('message', (m: WsMessage) => this.dispatch(m));
    this.socket.on('disconnect', (reason: string) => {
      console.warn(`[S1] WS disconnected: ${reason}`);
      // 断连时所有 pending 请求应立即 reject，不等 8s 超时 —— 否则挂起 Promise 会长期占用资源
      this.rejectPendingAll(new Error(`WS disconnected: ${reason}`));
    });
  }

  /** 断开连接（供 shutdownClient 等外部调用） */
  disconnect(): void {
    this.rejectPendingAll(new Error('WS client explicitly disconnected'));
    this.socket?.disconnect();
    this.socket = null;
  }

  /** 把 pending Map 中所有挂起请求立即 reject（断连 / 关闭时调用） */
  private rejectPendingAll(err: Error): void {
    if (this.pending.size === 0) return;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  /** 注册某类应答/广播的处理函数（非应答式广播用 onBroadcast） */
  on(cmd: string, handler: (m: WsMessage) => void): void {
    this.handlers.set(cmd, handler);
  }

  /** 所有非应答事件（seq 不可匹配 pending 的）都回调到这里 */
  onBroadcast(handler: (m: WsMessage) => void): void {
    this.handlers.set('*', handler);
  }

  /**
   * 注册「裸事件」下行广播（matchmaking:matched / room:update / room:destroyed 等不走
   * 'message' 包裹的事件，payload 直接是数据对象，无 cmd/seq）。connect 前调用可容错：
   * 先存入 rawHandlers，connect 成功后统一补挂到 socket。
   */
  onRaw(event: string, handler: (payload: any) => void): void {
    this.rawHandlers.set(event, handler);
    this.socket?.on(event, handler);
  }

  /**
   * 发送请求。事件名即 cmd（服务端用 @SubscribeMessage(cmd) 订阅）。
   * expectAck=false 时不登记 pending（用于 world.move 这类高频上报）。
   *
   * 服务端两种回包路径都要认：
   *  1) handler 直接 return → socket.io ack 回调（world.enter-scene / world.move 走这条）；
   *  2) handler 主动 client.emit('message', …) → 走 'message' 事件（player.heartbeat 等）。
   * 因此 ack 回调与 'message' 监听都汇入 dispatch，由 seq 匹配 pending。
   */
  send<T = any>(cmd: string, data: unknown, expectAck = true): Promise<WsMessage & { data: T }> {
    if (!this.socket) throw new Error('WS 未连接');
    // S8：上行计数（只计数，零行为变更）—— 两条路径共用此处，均会统计到
    bumpUp(cmd);
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      if (!expectAck) {
        this.socket.emit(cmd, { cmd, seq, data });
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`WS 请求超时：${cmd}`));
      }, ACK_TIMEOUT_MS);
      this.pending.set(seq, {
        resolve: resolve as (m: WsMessage) => void,
        reject,
        timer,
      });
      this.socket.emit(cmd, { cmd, seq, data }, (ack: WsMessage) => this.dispatch(ack));
    });
  }

  /**
   * 裸契约上行（匹配模块用）：payload 直接是数据对象，不包 {cmd, seq, data}
   * （matchmaking gateway 的 handler 直读 {mode}/{roomId}，服务端 E2E 同款发法）。
   * ack 回包无 seq，直接在回调里 resolve，不走 dispatch/pending 匹配。
   */
  sendRaw<T = any>(cmd: string, data: unknown): Promise<WsMessage & { data: T }> {
    if (!this.socket) throw new Error('WS 未连接');
    bumpUp(cmd);
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`WS 请求超时：${cmd}`));
      }, ACK_TIMEOUT_MS);
      this.pending.set(seq, {
        resolve: resolve as (m: WsMessage) => void,
        reject,
        timer,
      });
      this.socket.emit(cmd, data, (ack: WsMessage) => {
        const p = this.pending.get(seq);
        if (!p) return;
        this.pending.delete(seq);
        clearTimeout(p.timer);
        p.resolve(ack);
      });
    });
  }

  private dispatch(m: WsMessage): void {
    if (m && typeof m.seq === 'number' && this.pending.has(m.seq)) {
      const p = this.pending.get(m.seq)!;
      this.pending.delete(m.seq);
      clearTimeout(p.timer);
      p.resolve(m);
      return;
    }
    const h = this.handlers.get(m?.cmd) ?? this.handlers.get('*');
    if (h) h(m);
  }
}