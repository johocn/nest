import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GuandanService } from './guandan.service';
import { GuandanMode } from '@constants/enums';
import { ActionDto } from './guandan.types';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthService } from '@modules/auth/auth.service';
import type { JwtPayload } from '@modules/auth/auth.service';

/**
 * 掼蛋命名空间 /guandan：复用 nest 用户体系（JWT 鉴权）。
 * 连接阶段校验 token，无 token 直接断开，写入 client.data.playerId/accountId。
 * 与 /game 网关一致，彻底取代 sichuanmajiang 的游客兜底。
 */
@WebSocketGateway({
  namespace: '/guandan',
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class GuandanGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GuandanGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly guandan: GuandanService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake?.query?.token as string;
    if (!token) {
      this.logger.warn(`[Guandan] connection rejected: no token, socket=${client.id}`);
      client.disconnect();
      return;
    }
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      this.logger.warn(`[Guandan] connection rejected: invalid token, socket=${client.id}`);
      client.disconnect();
      return;
    }
    const isValid = await this.authService.validateToken(payload);
    if (!isValid) {
      this.logger.warn(`[Guandan] connection rejected: token version mismatch, player=${payload.playerId}`);
      client.disconnect();
      return;
    }
    client.data.playerId = payload.playerId;
    client.data.accountId = payload.accountId;
    this.logger.log(`[Guandan] player connected: ${payload.playerId}, socket=${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const playerId = client.data?.playerId;
    if (playerId) this.logger.log(`[Guandan] player disconnected: ${playerId}, socket=${client.id}`);
  }

  private errCode(err: any, fallback: number): number {
    return err?.response?.code ?? err?.getStatus?.() ?? fallback;
  }

  private room(tableId: string) {
    return `guandan:${tableId}`;
  }

  /** 给同桌每位真人推送各自视角的牌桌 */
  private async pushViews(tableId: string) {
    try {
      const targets = await this.guandan.broadcastTargets(tableId);
      for (const t of targets) {
        const view = await this.guandan.viewBySeat(tableId, t.seat);
        this.server.to(t.socketId).emit('guandan:update', view);
      }
    } catch (err: any) {
      this.logger.error(`pushViews failed: ${err?.message}`);
    }
  }

  @SubscribeMessage('guandan:create')
  async handleCreate(client: Socket, data: { mode?: string }) {
    try {
      const pid = client.data?.playerId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const mode = data?.mode === 'net' ? GuandanMode.NET : GuandanMode.AI;
      const { tableId, seat, view } = await this.guandan.create(pid, mode, client.id);
      client.join(this.room(tableId));
      await this.pushViews(tableId);
      return { code: 200, data: { tableId, seat, view } };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.GUANDAN_TABLE_NOT_FOUND), msg: err?.message };
    }
  }

  @SubscribeMessage('guandan:join')
  async handleJoin(client: Socket, data: { tableId: string }) {
    try {
      const pid = client.data?.playerId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const { seat, view } = await this.guandan.join(data.tableId, pid, client.id);
      client.join(this.room(data.tableId));
      await this.pushViews(data.tableId);
      return { code: 200, data: { seat, view } };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.GUANDAN_TABLE_NOT_FOUND), msg: err?.message };
    }
  }

  @OnEvent(GameEvents.GUANDAN_TABLE_TIMEOUT)
  async onTimeout(payload: { tableId: string }) {
    await this.pushViews(payload.tableId);
  }

  @SubscribeMessage('guandan:start')
  async handleStart(client: Socket, data: { tableId: string }) {
    try {
      const pid = client.data?.playerId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const { view } = await this.guandan.start(data.tableId, pid);
      await this.pushViews(data.tableId);
      return { code: 200, data: view };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.GUANDAN_INVALID_ACTION), msg: err?.message };
    }
  }

  @SubscribeMessage('guandan:action')
  async handleAction(
    client: Socket,
    data: { tableId: string; action: ActionDto },
  ) {
    try {
      const pid = client.data?.playerId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const view = await this.guandan.action(data.tableId, pid, data.action);
      await this.pushViews(data.tableId);
      return { code: 200, data: view };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.GUANDAN_ILLEGAL_COMBO), msg: err?.message };
    }
  }

  @SubscribeMessage('guandan:view')
  async handleView(client: Socket, data: { tableId: string }) {
    try {
      const pid = client.data?.playerId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const view = await this.guandan.view(data.tableId, pid);
      return { code: 200, data: view };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.GUANDAN_TABLE_NOT_FOUND), msg: err?.message };
    }
  }

  @SubscribeMessage('guandan:history')
  async handleHistory(client: Socket) {
    try {
      const pid = client.data?.playerId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const history = await this.guandan.history(pid);
      return { code: 200, data: history };
    } catch (err: any) {
      return { code: this.errCode(err, 50000), msg: err?.message };
    }
  }

  @SubscribeMessage('guandan:leave')
  async handleLeave(client: Socket, data: { tableId: string }) {
    try {
      const pid = client.data?.playerId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      await this.guandan.leave(data.tableId, pid);
      client.leave(this.room(data.tableId));
      await this.pushViews(data.tableId);
      return { code: 200 };
    } catch (err: any) {
      return { code: this.errCode(err, 50000), msg: err?.message };
    }
  }
}
