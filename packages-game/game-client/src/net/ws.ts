import { Platform } from '../platform/Platform';

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

  async connect(token: string): Promise<void> {
    if (typeof io !== 'function') {
      throw new Error('socket.io 未加载：请确认 index.html 引入了 /vendor/socket.io.min.js');
    }
    this.socket = io(Platform.env.wsUrl(), {
      transports: ['websocket'],
      query: { token },
      reconnection: true,
    });

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
    });
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