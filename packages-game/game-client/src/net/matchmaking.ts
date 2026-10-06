import type { WsClient } from './ws';

/** 服务端 MatchMode 枚举值（src/constants/enums.ts） */
export type MatchModeValue = 'ranked' | 'casual' | 'practice';

export const MATCH_MODES: MatchModeValue[] = ['ranked', 'casual', 'practice'];

/** matchmaking:join ack data（与服务端 matchmaking.service joinQueue 返回逐字一致） */
export interface MatchQueueResult {
  queued: boolean;
  position: number;
}

/** matchmaking:cancel ack data */
export interface MatchCancelResult {
  cancelled: boolean;
}

/** matchmaking:status ack data */
export interface MatchQueueStatus {
  inQueue: boolean;
  score?: number;
}

/** matchmaking:matched 裸广播 payload（与 matchmaking.gateway emit 逐字一致） */
export interface MatchedPayload {
  mode: string;
  roomId: string;
  players: string[];
}

/** room.service RoomPlayer（role 服务端取值 attacker/defender/pve/spectator；matched 后首次 room:update 前客户端允许 '-' 占位） */
export interface RoomPlayerView {
  playerId: string;
  role: string;
  ready: boolean;
  joinedAt: string;
}

/** room.service Room */
export interface RoomView {
  id: string;
  mode: string;
  status: 'matching' | 'forming' | 'ready' | 'in_progress' | 'finished' | 'timeout';
  players: RoomPlayerView[];
  maxPlayers: number;
  minPlayers: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  battleConfig?: Record<string, any>;
}

/** room:destroyed 裸广播 payload */
export interface RoomDestroyedPayload {
  roomId: string;
  reason: string;
}

export interface MatchmakingAttachOptions {
  onMatched?: (p: MatchedPayload) => void;
  onRoomUpdate?: (room: RoomView) => void;
  onRoomDestroyed?: (p: RoomDestroyedPayload) => void;
}

/** 匹配下行不走 'message' 包裹：直接注册三个裸事件（payload 是数据对象本身，无 cmd/seq） */
export function attachMatchmaking(ws: WsClient, opts: MatchmakingAttachOptions): void {
  ws.onRaw('matchmaking:matched', (p: MatchedPayload) => opts.onMatched?.(p));
  ws.onRaw('room:update', (room: RoomView) => opts.onRoomUpdate?.(room));
  ws.onRaw('room:destroyed', (p: RoomDestroyedPayload) => opts.onRoomDestroyed?.(p));
}

/** 匹配模块 ack 是 HTTP 风格 code：仅 200 算成功（区别于 game gateway 的 code=0） */
function ackOk<T>(ack: { code: number; msg?: string; data?: T }, cmd: string): T {
  if (ack.code !== 200) throw new Error(ack.msg || `${cmd} 失败（code=${ack.code}）`);
  return ack.data as T;
}

export async function joinQueue(ws: WsClient, mode: MatchModeValue): Promise<MatchQueueResult> {
  return ackOk(await ws.sendRaw<MatchQueueResult>('matchmaking:join', { mode }), 'matchmaking:join');
}

export async function cancelQueue(ws: WsClient, mode: MatchModeValue): Promise<MatchCancelResult> {
  return ackOk(await ws.sendRaw<MatchCancelResult>('matchmaking:cancel', { mode }), 'matchmaking:cancel');
}

export async function getQueueStatus(ws: WsClient, mode: MatchModeValue): Promise<MatchQueueStatus> {
  return ackOk(await ws.sendRaw<MatchQueueStatus>('matchmaking:status', { mode }), 'matchmaking:status');
}

export async function setRoomReady(ws: WsClient, roomId: string, ready = true): Promise<RoomView> {
  return ackOk(await ws.sendRaw<RoomView>('room:ready', { roomId, ready }), 'room:ready');
}

export async function leaveRoom(ws: WsClient, roomId: string, reason?: string): Promise<void> {
  await ackOk(await ws.sendRaw('room:leave', { roomId, reason }), 'room:leave');
}
