import { WsClient } from '../net/ws';
import { Session } from '../net/Session';

/** 与服务端 werewolf.types 对齐的本地视图类型（仅取渲染所需字段） */
export interface PublicPlayerView {
  seat: number;
  name: string;
  alive: boolean;
  isHost: boolean;
  police: boolean;
  role: string | null;
}
export interface PrivatePlayerView {
  seat: number;
  alive: boolean;
  role: string | null;
  camp: string | null;
  teammates: number[];
  isPolice: boolean;
  seerKnown: Record<number, string>;
  witchHasAntidote: boolean;
  witchHasPoison: boolean;
  canAct: boolean;
  legalTargets: number[];
  witchTonightKill: number | null;
  hunterMayShoot: boolean;
  hunterTargets: number[];
  /** 此刻是否可以发言 */
  canSpeak: boolean;
  /** 此刻是否可以留下遗言 */
  canLastWords: boolean;
  /** 狼人夜间频道消息（仅狼人可见） */
  wolfMessages: RoomMessage[];
  /** 此刻是否可在狼人频道发言 */
  canWolfSpeak: boolean;
  lastError?: string;
}
/** 房间内一条发言（发言 / 遗言 / 系统公告） */
export interface RoomMessage {
  seq: number;
  seat: number;
  name: string;
  text: string;
  kind: 'speech' | 'lastwords' | 'system';
  channel?: 'public' | 'wolf';
  at: number;
}
export interface RoomSnapshot {
  roomId: string;
  step: string;
  cycle: number;
  message: string;
  phaseEndsAt: number | null;
  winner: string | null;
  revote: number;
  players: PublicPlayerView[];
  deathsThisStep: number[];
  tally: Record<number, number>;
  pendingActions: number;
  messages: RoomMessage[];
}
export interface WerewolfSync {
  public: RoomSnapshot;
  private: PrivatePlayerView;
}

export type SyncHandler = (data: WerewolfSync) => void;

/**
 * 狼人杀客户端：封装 socket.io 命令与状态同步。
 * 复用框架既有 WsClient / Session；所有房间状态变化服务端统一以 cmd='werewolf.sync' 下发。
 */
export class WerewolfClient {
  private ws: WsClient | null = null;
  private syncHandler: SyncHandler | null = null;
  private _roomId = '';

  get roomId(): string {
    return this._roomId;
  }

  async connect(): Promise<void> {
    if (!this.ws) {
      this.ws = new WsClient();
      await this.ws.connect(Session.token ?? '');
      this.ws.on('werewolf.sync', (m: any) => {
        if (m?.data?.public) this.syncHandler?.(m.data as WerewolfSync);
      });
    }
  }

  onSync(cb: SyncHandler): void {
    this.syncHandler = cb;
  }

  private requireWs(): WsClient {
    if (!this.ws) throw new Error('狼人杀未连接');
    return this.ws;
  }

  async createRoom(
    opts: {
      name?: string;
      playerCount?: number;
      roles?: string[];
      durations?: Record<string, number>;
    } = {},
  ): Promise<WerewolfSync> {
    await this.connect();
    const ack = await this.requireWs().send<WerewolfSync>('werewolf.create', {
      name: opts.name ?? Session.playerId ?? '玩家',
      playerCount: opts.playerCount,
      roles: opts.roles,
      durations: opts.durations,
    });
    if (ack.code !== 0) throw new Error(ack.msg || '建房失败');
    this._roomId = ack.data?.roomId ?? '';
    return ack.data;
  }

  async joinRoom(roomId: string, name = '玩家'): Promise<void> {
    await this.connect();
    this._roomId = roomId;
    const ack = await this.requireWs().send('werewolf.join', { roomId, name });
    if (ack.code !== 0) throw new Error(ack.msg || '加入失败');
  }

  async leaveRoom(): Promise<void> {
    if (!this._roomId) return;
    await this.requireWs().send('werewolf.leave', { roomId: this._roomId });
  }

  async startRoom(): Promise<void> {
    const ack = await this.requireWs().send('werewolf.start', {
      roomId: this._roomId,
    });
    if (ack.code !== 0) throw new Error(ack.msg || '开局失败');
  }

  /** 开发/演示：填充机器人，便于单人体验 */
  async devFill(count = 8): Promise<void> {
    const ack = await this.requireWs().send('werewolf.dev_fill', {
      roomId: this._roomId,
      count,
    });
    if (ack.code !== 0) throw new Error(ack.msg || '填充失败');
  }

  /** 提交行动（狼刀/查验/女巫/守卫/投票/猎人开枪） */
  async action(payload: Record<string, unknown>): Promise<void> {
    const ack = await this.requireWs().send('werewolf.action', {
      roomId: this._roomId,
      payload,
    });
    if (ack.code !== 0) throw new Error(ack.msg || '行动失败');
  }

  /** 发言 / 遗言 */
  async say(text: string): Promise<void> {
    const ack = await this.requireWs().send('werewolf.say', {
      roomId: this._roomId,
      text,
    });
    if (ack.code !== 0) throw new Error(ack.msg || '发言失败');
  }

  /** 狼人夜间频道发言（仅狼人可见） */
  async wolfSay(text: string): Promise<void> {
    const ack = await this.requireWs().send('werewolf.wolf_say', {
      roomId: this._roomId,
      text,
    });
    if (ack.code !== 0) throw new Error(ack.msg || '狼人频道发言失败');
  }
}
