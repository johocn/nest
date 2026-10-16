import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SanguoshaService } from './sanguosha.service';
import { SanguoshaMode } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { GameEvents } from '@event-bus/game-events';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthService } from '@modules/auth/auth.service';
import { resolveTenantId } from '@modules/tenant';
import type { JwtPayload } from '@modules/auth/auth.service';

/**
 * 三国杀命名空间 /sanguosha：复用 nest 用户体系（JWT 鉴权）。
 * 连接阶段校验 token，写入 client.data.playerId/accountId/tenantId。
 */
@WebSocketGateway({
  namespace: '/sanguosha',
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class SanguoshaGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SanguoshaGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sgs: SanguoshaService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake?.query?.token as string;
    if (!token) {
      this.logger.warn(`[Sanguosha] connection rejected: no token, socket=${client.id}`);
      client.disconnect();
      return;
    }
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      this.logger.warn(`[Sanguosha] connection rejected: invalid token, socket=${client.id}`);
      client.disconnect();
      return;
    }
    const isValid = await this.authService.validateToken(payload);
    if (!isValid) {
      this.logger.warn(`[Sanguosha] connection rejected: token version mismatch, player=${payload.playerId}`);
      client.disconnect();
      return;
    }
    const tenantId = resolveTenantId(
      payload,
      client.handshake?.headers as any,
      (client.handshake?.headers as any)?.host,
    );
    client.data.playerId = payload.playerId;
    client.data.accountId = payload.accountId;
    client.data.tenantId = tenantId;
    this.logger.log(`[Sanguosha] player connected: ${payload.playerId}, tenant=${tenantId}, socket=${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const playerId = client.data?.playerId;
    if (playerId) this.logger.log(`[Sanguosha] player disconnected: ${playerId}, socket=${client.id}`);
  }

  private errCode(err: any, fallback: number): number {
    return err?.response?.code ?? err?.getStatus?.() ?? fallback;
  }

  private room(tableId: string) {
    return `sanguosha:${tableId}`;
  }

  /** 按座位推送各自视角的牌桌（隐藏他人手牌/身份） */
  private async pushViews(tableId: string) {
    try {
      const targets = await this.sgs.broadcastTargets(tableId);
      for (const t of targets) {
        const view = await this.sgs.viewBySeat(tableId, t.seat);
        this.server.to(t.socketId).emit('sanguosha:update', view);
      }
    } catch (err: any) {
      this.logger.error(`pushViews failed: ${err?.message}`);
    }
  }

  @SubscribeMessage('sanguosha:create')
  async handleCreate(client: Socket, data: { mode?: string }) {
    try {
      const pid = client.data?.playerId;
      const tid = client.data?.tenantId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const mode = data?.mode === 'net' ? SanguoshaMode.NET : SanguoshaMode.AI;
      const { tableId, seat, view } = await this.sgs.create(pid, mode, tid, client.id);
      client.join(this.room(tableId));
      await this.pushViews(tableId);
      return { code: 200, data: { tableId, seat, view } };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.SANGUOSHA_TABLE_NOT_FOUND), msg: err?.message };
    }
  }

  @SubscribeMessage('sanguosha:join')
  async handleJoin(client: Socket, data: { tableId: string }) {
    try {
      const pid = client.data?.playerId;
      const tid = client.data?.tenantId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const { seat, view } = await this.sgs.join(data.tableId, pid, tid, client.id);
      client.join(this.room(data.tableId));
      await this.pushViews(data.tableId);
      return { code: 200, data: { seat, view } };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.SANGUOSHA_TABLE_NOT_FOUND), msg: err?.message };
    }
  }

  @OnEvent(GameEvents.SANGUOSHA_TABLE_TIMEOUT)
  async onTimeout(payload: { tableId: string }) {
    await this.pushViews(payload.tableId);
  }

  @SubscribeMessage('sanguosha:start')
  async handleStart(client: Socket, data: { tableId: string }) {
    try {
      const pid = client.data?.playerId;
      const tid = client.data?.tenantId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const { view } = await this.sgs.start(data.tableId, pid, tid);
      await this.pushViews(data.tableId);
      return { code: 200, data: view };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.SANGUOSHA_INVALID_ACTION), msg: err?.message };
    }
  }

  @SubscribeMessage('sanguosha:action')
  async handleAction(
    client: Socket,
    data: { tableId: string; action: any },
  ) {
    try {
      const pid = client.data?.playerId;
      const tid = client.data?.tenantId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const view = await this.sgs.action(data.tableId, pid, tid, data.action);
      await this.pushViews(data.tableId);
      return { code: 200, data: view };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.SANGUOSHA_INVALID_ACTION), msg: err?.message };
    }
  }

  @SubscribeMessage('sanguosha:view')
  async handleView(client: Socket, data: { tableId: string }) {
    try {
      const pid = client.data?.playerId;
      const tid = client.data?.tenantId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const view = await this.sgs.view(data.tableId, pid, tid);
      return { code: 200, data: view };
    } catch (err: any) {
      return { code: this.errCode(err, ErrorCodes.SANGUOSHA_TABLE_NOT_FOUND), msg: err?.message };
    }
  }

  @SubscribeMessage('sanguosha:history')
  async handleHistory(client: Socket) {
    try {
      const pid = client.data?.playerId;
      const tid = client.data?.tenantId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      const history = await this.sgs.history(pid, tid);
      return { code: 200, data: history };
    } catch (err: any) {
      return { code: this.errCode(err, 50000), msg: err?.message };
    }
  }

  @SubscribeMessage('sanguosha:leave')
  async handleLeave(client: Socket, data: { tableId: string }) {
    try {
      const pid = client.data?.playerId;
      const tid = client.data?.tenantId;
      if (!pid) return { code: ErrorCodes.TOKEN_INVALID, msg: '未认证' };
      await this.sgs.leave(data.tableId, pid, tid);
      client.leave(this.room(data.tableId));
      await this.pushViews(data.tableId);
      return { code: 200 };
    } catch (err: any) {
      return { code: this.errCode(err, 50000), msg: err?.message };
    }
  }
}
