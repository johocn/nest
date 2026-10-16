import { WebSocketGateway, WebSocketServer, SubscribeMessage } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { SichuanMahjongService } from './sichuanmajiang.service';
import { SichuanMahjongMode } from '@constants/enums';
import { ActionDto } from './sichuanmajiang.types';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import { OnEvent } from '@nestjs/event-emitter';

/**
 * 独立命名空间：/game 已被 GameGateway 的 JWT 鉴权接管（无 token 会被直接断开），
 * 麻将作为"仅模拟"的独立玩法使用自己的命名空间，免去登录即可多用户共享牌桌。
 */
@WebSocketGateway({
  namespace: '/sichuanmajiang',
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class SichuanMahjongGateway {
  private readonly logger = new Logger(SichuanMahjongGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly sichuanmajiang: SichuanMahjongService) {}

  /** 演示可带 playerId；接入正式登录后可改用 client.data.playerId */
  private pid(client: Socket, data: any): string {
    return client.data?.playerId || data?.playerId || `guest-${(Math.random() * 1e6) | 0}`;
  }

  private room(tableId: string) {
    return `sichuanmajiang:${tableId}`;
  }

  /** GameException 继承 HttpException，真实业务码在 response.code（getStatus 恒为 200） */
  private errCode(err: any, fallback: number): number {
    return err?.response?.code ?? err?.getStatus?.() ?? fallback;
  }

  /** 给同桌每位真人推送"自己视角"的牌桌（yourSeat 各不相同） */
  private async pushViews(tableId: string) {
    try {
      const targets = await this.sichuanmajiang.broadcastTargets(tableId);
      for (const t of targets) {
        const view = await this.sichuanmajiang.viewBySeat(tableId, t.seat);
        this.server.to(t.socketId).emit('sichuanmajiang:update', view);
      }
    } catch (err: any) {
      this.logger.error(`pushViews failed: ${err?.message}`);
    }
  }

  @SubscribeMessage('sichuanmajiang:create')
  async handleCreate(client: Socket, data: { mode?: string; playerId?: string }) {
    try {
      const pid = this.pid(client, data);
      const mode = data?.mode === 'net' ? SichuanMahjongMode.NET : SichuanMahjongMode.AI;
      const { tableId, seat, view } = await this.sichuanmajiang.create(pid, mode, client.id);
      client.join(this.room(tableId));
      await this.pushViews(tableId);
      // 回执带上本人视角，客户端无需再拉一次，避免竞态
      return { code: 200, data: { tableId, seat, view } };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.SICHUANMAJIANG_TABLE_NOT_FOUND), msg: err?.message };
    }
  }

  @SubscribeMessage('sichuanmajiang:join')
  async handleJoin(client: Socket, data: { tableId: string; playerId?: string }) {
    try {
      const pid = this.pid(client, data);
      const { seat, view } = await this.sichuanmajiang.join(data.tableId, pid, client.id);
      client.join(this.room(data.tableId));
      await this.pushViews(data.tableId);
      return { code: 200, data: { seat, view } };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.SICHUANMAJIANG_TABLE_NOT_FOUND), msg: err?.message };
    }
  }

  /** 超时自动过牌后把最新牌桌推给同桌所有人 */
  @OnEvent(GameEvents.SICHUANMAJIANG_TABLE_TIMEOUT)
  async onTimeout(payload: { tableId: string }) {
    await this.pushViews(payload.tableId);
  }

  @SubscribeMessage('sichuanmajiang:start')
  async handleStart(client: Socket, data: { tableId: string; playerId?: string }) {
    try {
      const pid = this.pid(client, data);
      const { view } = await this.sichuanmajiang.start(data.tableId, pid);
      await this.pushViews(data.tableId);
      return { code: 200, data: view };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.SICHUANMAJIANG_INVALID_ACTION), msg: err?.message };
    }
  }

  @SubscribeMessage('sichuanmajiang:action')
  async handleAction(
    client: Socket,
    data: { tableId: string; action: ActionDto; playerId?: string },
  ) {
    try {
      const pid = this.pid(client, data);
      await this.sichuanmajiang.action(data.tableId, pid, data.action);
      await this.pushViews(data.tableId);
      // 回执用操作者自身视角
      const table = await this.sichuanmajiang.broadcastTargets(data.tableId);
      const mine = table.find((t) => t.socketId === client.id);
      const view = mine
        ? await this.sichuanmajiang.viewBySeat(data.tableId, mine.seat)
        : await this.sichuanmajiang.view(data.tableId, pid);
      return { code: 200, data: view };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.SICHUANMAJIANG_INVALID_ACTION), msg: err?.message };
    }
  }

  @SubscribeMessage('sichuanmajiang:leave')
  async handleLeave(client: Socket, data: { tableId: string; playerId?: string }) {
    try {
      const pid = this.pid(client, data);
      await this.sichuanmajiang.leave(data.tableId, pid);
      client.leave(this.room(data.tableId));
      await this.pushViews(data.tableId);
      return { code: 200 };
    } catch (err: any) {
      return { code: this.errCode(err, 50000), msg: err?.message };
    }
  }
}
