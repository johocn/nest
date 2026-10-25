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
import { OnEvent } from '@nestjs/event-emitter';
import { DoudizhuService } from './doudizhu.service';
import { DoudizhuMatchService } from './doudizhu-match.service';
import { DoudizhuMode } from '@constants/enums';
import { DoudizhuActionDto } from './doudizhu.types';
import { AiLevel } from './engine';
import { GameEvents } from '@event-bus/game-events';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import { AuthService } from '@modules/auth/auth.service';
import { PlayerService } from '@modules/player/player.service';
import type { JwtPayload } from '@modules/auth/auth.service';

/**
 * 斗地主命名空间 /doudizhu：复用 nest 用户体系（JWT 鉴权）。
 * 连接阶段校验 token，无 token / 失效 / 版本不符直接断开。
 */
@WebSocketGateway({
  namespace: '/doudizhu',
  cors: { origin: '*' },
  transports: ['websocket'],
})
export class DoudizhuGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(DoudizhuGateway.name);

  @WebSocketServer()
  server: Server;

  /** playerId -> 该玩家当前所有 socketId（用于好友邀请定向推送） */
  private playerSockets = new Map<string, Set<string>>();
  /** playerId -> 上次发表情时间（节流） */
  private emojiCooldown = new Map<string, number>();

  constructor(
    private readonly doudizhu: DoudizhuService,
    private readonly matchService: DoudizhuMatchService,
    private readonly playerService: PlayerService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake?.query?.token as string;
    if (!token) {
      this.logger.warn(
        `[Doudizhu] connection rejected: no token, socket=${client.id}`,
      );
      client.disconnect();
      return;
    }
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      this.logger.warn(
        `[Doudizhu] connection rejected: invalid token, socket=${client.id}`,
      );
      client.disconnect();
      return;
    }
    const isValid = await this.authService.validateToken(payload);
    if (!isValid) {
      this.logger.warn(
        `[Doudizhu] connection rejected: token version mismatch, player=${payload.playerId}`,
      );
      client.disconnect();
      return;
    }
    client.data.playerId = payload.playerId;
    client.data.accountId = payload.accountId;
    const set = this.playerSockets.get(payload.playerId) ?? new Set<string>();
    set.add(client.id);
    this.playerSockets.set(payload.playerId, set);
    this.logger.log(
      `[Doudizhu] player connected: ${payload.playerId}, socket=${client.id}`,
    );
  }

  async handleDisconnect(client: Socket) {
    const playerId = client.data?.playerId;
    if (playerId) {
      const set = this.playerSockets.get(playerId);
      if (set) {
        set.delete(client.id);
        if (!set.size) this.playerSockets.delete(playerId);
      }
      this.emojiCooldown.delete(playerId);
      this.logger.log(
        `[Doudizhu] player disconnected: ${playerId}, socket=${client.id}`,
      );
      // 最后一个连接断开时退出匹配队列，避免离线玩家被撮合进牌桌
      if (!this.playerSockets.has(playerId)) {
        try {
          await this.matchService.cancel(playerId);
        } catch (err: any) {
          this.logger.warn(
            `match cancel on disconnect failed: ${err?.message}`,
          );
        }
      }
    }
    try {
      await this.doudizhu.disconnect(client.id);
    } catch (err: any) {
      this.logger.warn(`disconnect cleanup failed: ${err?.message}`);
    }
  }

  private errPayload(
    err: any,
    fallback: number,
  ): { code: number; message: string } {
    return {
      code: err?.response?.code ?? err?.getStatus?.() ?? fallback,
      message: err?.response?.message ?? err?.message ?? 'error',
    };
  }

  /** 给同桌每位真人推送各自视角的牌桌 */
  private async pushViews(tableId: string) {
    try {
      const targets = await this.doudizhu.broadcastTargets(tableId);
      for (const t of targets) {
        const view = await this.doudizhu.viewBySeat(tableId, t.seat);
        this.server.to(t.socketId).emit('doudizhu:update', view);
      }
    } catch (err: any) {
      this.logger.error(`pushViews failed: ${err?.message}`);
    }
  }

  @SubscribeMessage('doudizhu:create')
  async handleCreate(
    client: Socket,
    payload: { mode?: DoudizhuMode; aiLevel?: AiLevel },
  ) {
    try {
      const mode = payload?.mode ?? DoudizhuMode.AI;
      const aiLevel = payload?.aiLevel ?? 'normal';
      const res = await this.doudizhu.create(
        client.data.playerId,
        mode,
        client.id,
        aiLevel,
      );
      client.emit('doudizhu:created', res);
      await this.pushViews(res.tableId);
    } catch (err: any) {
      client.emit(
        'doudizhu:error',
        this.errPayload(err, ErrorCodes.DOUDIZHU_INVALID_ACTION),
      );
    }
  }

  @SubscribeMessage('doudizhu:join')
  async handleJoin(client: Socket, payload: { tableId: string }) {
    try {
      if (!payload?.tableId)
        throw new GameException(
          ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
          '缺少 tableId',
        );
      const res = await this.doudizhu.join(
        payload.tableId,
        client.data.playerId,
        client.id,
      );
      client.emit('doudizhu:joined', res);
      await this.pushViews(payload.tableId);
    } catch (err: any) {
      client.emit(
        'doudizhu:error',
        this.errPayload(err, ErrorCodes.DOUDIZHU_INVALID_ACTION),
      );
    }
  }

  @SubscribeMessage('doudizhu:start')
  async handleStart(client: Socket, payload: { tableId: string }) {
    try {
      if (!payload?.tableId)
        throw new GameException(
          ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
          '缺少 tableId',
        );
      const res = await this.doudizhu.start(
        payload.tableId,
        client.data.playerId,
      );
      client.emit('doudizhu:started', res);
      await this.pushViews(payload.tableId);
    } catch (err: any) {
      client.emit(
        'doudizhu:error',
        this.errPayload(err, ErrorCodes.DOUDIZHU_INVALID_ACTION),
      );
    }
  }

  /** 房主选择「等待好友上线」：取消 1 分钟自动补位 */
  @SubscribeMessage('doudizhu:wait')
  async handleWait(client: Socket, payload: { tableId: string }) {
    try {
      if (!payload?.tableId)
        throw new GameException(
          ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
          '缺少 tableId',
        );
      const res = await this.doudizhu.waitForFriends(
        payload.tableId,
        client.data.playerId,
      );
      client.emit('doudizhu:waiting', { tableId: payload.tableId, ...res });
    } catch (err: any) {
      client.emit(
        'doudizhu:error',
        this.errPayload(err, ErrorCodes.DOUDIZHU_INVALID_ACTION),
      );
    }
  }

  @SubscribeMessage('doudizhu:bid')
  async handleBid(
    client: Socket,
    payload: { tableId: string; choice: 'grab' | 'mingpai' | 'nograb' },
  ) {
    await this.apply(client, payload?.tableId, {
      type: 'bid',
      choice: payload?.choice,
    });
  }

  @SubscribeMessage('doudizhu:double')
  async handleDouble(
    client: Socket,
    payload: { tableId: string; action: 'none' | 'double' | 'super' },
  ) {
    await this.apply(client, payload?.tableId, {
      type: 'double',
      action: payload?.action,
    });
  }

  @SubscribeMessage('doudizhu:play')
  async handlePlay(
    client: Socket,
    payload: { tableId: string; cards: string[] },
  ) {
    await this.apply(client, payload?.tableId, {
      type: 'play',
      cards: payload?.cards ?? [],
    });
  }

  @SubscribeMessage('doudizhu:pass')
  async handlePass(client: Socket, payload: { tableId: string }) {
    await this.apply(client, payload?.tableId, { type: 'pass' });
  }

  private async apply(
    client: Socket,
    tableId: string | undefined,
    dto: DoudizhuActionDto,
  ) {
    try {
      if (!tableId)
        throw new GameException(
          ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
          '缺少 tableId',
        );
      await this.doudizhu.action(tableId, client.data.playerId, dto);
      await this.pushViews(tableId);
    } catch (err: any) {
      client.emit(
        'doudizhu:error',
        this.errPayload(err, ErrorCodes.DOUDIZHU_ILLEGAL_COMBO),
      );
    }
  }

  @SubscribeMessage('doudizhu:view')
  async handleView(client: Socket, payload: { tableId: string }) {
    try {
      if (!payload?.tableId)
        throw new GameException(
          ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
          '缺少 tableId',
        );
      const view = await this.doudizhu.view(
        payload.tableId,
        client.data.playerId,
      );
      client.emit('doudizhu:update', view);
    } catch (err: any) {
      client.emit(
        'doudizhu:error',
        this.errPayload(err, ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND),
      );
    }
  }

  @SubscribeMessage('doudizhu:emoji')
  async handleEmoji(
    client: Socket,
    payload: { tableId: string; emoji?: string },
  ) {
    try {
      const tableId = payload?.tableId;
      if (!tableId) return;
      const pid = client.data.playerId;
      const now = Date.now();
      const last = this.emojiCooldown.get(pid) ?? 0;
      if (now - last < 1000) return; // 1s 节流
      this.emojiCooldown.set(pid, now);
      const targets = await this.doudizhu.broadcastTargets(tableId);
      for (const t of targets) {
        this.server.to(t.socketId).emit('doudizhu:emoji', {
          playerId: pid,
          emoji: payload?.emoji ?? '👍',
        });
      }
    } catch {
      /* 表情失败不影响牌局 */
    }
  }

  @SubscribeMessage('doudizhu:replay')
  async handleReplay(client: Socket, payload: { tableId: string }) {
    try {
      if (!payload?.tableId)
        throw new GameException(
          ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
          '缺少 tableId',
        );
      const data = await this.doudizhu.replay(
        payload.tableId,
        client.data.playerId,
      );
      client.emit('doudizhu:replay-data', data);
    } catch (err: any) {
      client.emit(
        'doudizhu:error',
        this.errPayload(err, ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND),
      );
    }
  }

  @SubscribeMessage('doudizhu:leave')
  async handleLeave(client: Socket, payload: { tableId: string }) {
    try {
      if (!payload?.tableId) return;
      await this.doudizhu.leave(payload.tableId, client.data.playerId);
      await this.pushViews(payload.tableId);
    } catch (err: any) {
      client.emit(
        'doudizhu:error',
        this.errPayload(err, ErrorCodes.DOUDIZHU_INVALID_ACTION),
      );
    }
  }

  @SubscribeMessage('doudizhu:host')
  async handleHost(client: Socket, payload: { tableId: string; on: boolean }) {
    try {
      if (!payload?.tableId)
        throw new GameException(
          ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
          '缺少 tableId',
        );
      await this.doudizhu.host(
        payload.tableId,
        client.data.playerId,
        !!payload?.on,
      );
      await this.pushViews(payload.tableId);
    } catch (err: any) {
      client.emit(
        'doudizhu:error',
        this.errPayload(err, ErrorCodes.DOUDIZHU_INVALID_ACTION),
      );
    }
  }

  // ===== 牌桌状态变化 → 推送给同桌真人（自动补位/超时托管/回合切换等） =====

  /** 牌桌更新（入座/开局/动作）后刷新各座位视角 */
  @OnEvent('doudizhu:table:updated')
  async onTableUpdated(payload: { tableId: string }) {
    if (payload?.tableId) await this.pushViews(payload.tableId);
  }

  /** 回合超时后 AI 代打，刷新各座位视角 */
  @OnEvent('doudizhu:table:timeout')
  async onTableTimeout(payload: { tableId: string }) {
    if (payload?.tableId) await this.pushViews(payload.tableId);
  }

  // ===== 匹配（3 人撮合，独立于通用 2 人 matchmaking） =====

  /** 匹配成功后通知每位玩家去加入对应斗地主桌（socket 只在本命名空间注册） */
  @OnEvent(GameEvents.DOUDIZHU_MATCHED)
  async onMatched(payload: { tableId: string; players: string[] }) {
    const msg = { tableId: payload.tableId, players: payload.players };
    for (const pid of payload.players) {
      const sockets = this.playerSockets.get(pid);
      if (!sockets?.size) {
        this.logger.warn(`[Doudizhu] matched but player offline: ${pid}`);
        continue;
      }
      for (const sid of sockets)
        this.server.to(sid).emit('doudizhu:matched', msg);
    }
  }

  @SubscribeMessage('doudizhu:matchmaking:join')
  async handleMatchJoin(client: Socket) {
    try {
      const playerId = client.data?.playerId;
      if (!playerId) return { code: 401, msg: '未认证' };
      const player = await this.playerService.getById(playerId);
      if (!player) return { code: 404, msg: '玩家不存在' };
      const power = player.level * 1000 + Number(player.exp);
      const res = await this.matchService.join(playerId, power);
      return { code: 200, msg: '已加入匹配队列', data: res };
    } catch (err: any) {
      return { code: err.getStatus?.() ?? 400, msg: err.message };
    }
  }

  @SubscribeMessage('doudizhu:matchmaking:cancel')
  async handleMatchCancel(client: Socket) {
    try {
      const playerId = client.data?.playerId;
      if (!playerId) return { code: 401, msg: '未认证' };
      const res = await this.matchService.cancel(playerId);
      return { code: 200, data: res };
    } catch (err: any) {
      return { code: err.getStatus?.() ?? 400, msg: err.message };
    }
  }

  @SubscribeMessage('doudizhu:matchmaking:status')
  async handleMatchStatus(client: Socket) {
    try {
      const playerId = client.data?.playerId;
      if (!playerId) return { code: 401, msg: '未认证' };
      const res = await this.matchService.status(playerId);
      return { code: 200, data: res };
    } catch (err: any) {
      return { code: err.getStatus?.() ?? 400, msg: err.message };
    }
  }
}
