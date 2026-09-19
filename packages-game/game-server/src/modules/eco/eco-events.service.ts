import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHmac, createHash, timingSafeEqual } from 'crypto';
import { AuthAccount } from '@modules/auth/entities/auth-account.entity';
import { Player } from '@modules/player/entities/player.entity';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { EcoEventDto, ECO_ACTIONS } from './dto/eco-event.dto';

const TS_WINDOW_SECONDS = 300;
const REPLAY_TTL_SECONDS = 300;

export interface EcoStats {
  received: number;
  rejected: number;
  notBound: number;
  byAction: Record<string, number>;
}

@Injectable()
export class EcoEventsService {
  private readonly logger = new Logger(EcoEventsService.name);
  private readonly sharedSecret: string | undefined;
  private readonly stats: EcoStats = {
    received: 0,
    rejected: 0,
    notBound: 0,
    byAction: {},
  };

  constructor(
    @InjectRepository(AuthAccount)
    private readonly accountRepo: Repository<AuthAccount>,
    @InjectRepository(Player)
    private readonly playerRepo: Repository<Player>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
    configService: ConfigService,
  ) {
    this.sharedSecret =
      configService.get<string>('ECO_SHARED_SECRET') ?? undefined;
    if (!this.sharedSecret) {
      this.logger.warn('ECO_SHARED_SECRET 未配置，生态行为接口将拒绝所有请求');
    }
  }

  async handle(
    rawBody: string,
    ts: string,
    sign: string,
    dto: EcoEventDto,
  ): Promise<{ success: true }> {
    this.stats.received += 1;

    if (!this.verifySignature(rawBody, ts, sign)) {
      return this.reject('签名校验失败');
    }
    if (!this.isWithinWindow(ts)) {
      return this.reject('时间戳超出 ±300s 窗口');
    }

    const digest = createHash('sha256')
      .update(`${rawBody}|${ts}`)
      .digest('hex');
    const acquired = await this.cacheService.acquireLock(
      `eco:evt:${digest}`,
      REPLAY_TTL_SECONDS,
    );
    if (!acquired) {
      return this.reject('重复上报', ErrorCodes.ECO_REPLAY);
    }

    if (!(ECO_ACTIONS as readonly string[]).includes(dto.action)) {
      return this.reject('未知行为类型', ErrorCodes.ECO_UNKNOWN_ACTION);
    }
    this.stats.byAction[dto.action] = (this.stats.byAction[dto.action] ?? 0) + 1;

    const playerId = await this.findPlayerIdBySsoId(dto.ssoId);
    if (!playerId) {
      this.stats.notBound += 1;
      return { success: true };
    }

    this.eventBus.emit(GameEvents.ECO_ACTION, {
      playerId,
      action: dto.action,
      scope: dto.scope,
      targetId: dto.targetId,
      extra: dto.extra,
    });
    return { success: true };
  }

  getStats(): EcoStats {
    return { ...this.stats, byAction: { ...this.stats.byAction } };
  }

  private verifySignature(rawBody: string, ts: string, sign: string): boolean {
    if (!this.sharedSecret || !ts || !sign) return false;
    const expected = createHmac('sha256', this.sharedSecret)
      .update(`${rawBody}|${ts}`)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(sign.toLowerCase(), 'hex');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }

  private isWithinWindow(ts: string): boolean {
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return false;
    return Math.abs(Math.floor(Date.now() / 1000) - tsNum) <= TS_WINDOW_SECONDS;
  }

  private async findPlayerIdBySsoId(ssoId: string): Promise<string | null> {
    const account = await this.accountRepo.findOne({ where: { ssoId } });
    if (!account) return null;
    const player = await this.playerRepo.findOne({
      where: { accountId: account.id },
    });
    return player?.id ?? null;
  }

  private reject(msg: string, code: number = ErrorCodes.ECO_SIGN_INVALID): never {
    this.stats.rejected += 1;
    throw new GameException(code, msg);
  }
}
