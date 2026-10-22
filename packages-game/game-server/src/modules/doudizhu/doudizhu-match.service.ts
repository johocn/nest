import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { DoudizhuTableService } from './doudizhu-table.service';
import { AiLevel } from './engine';

const QUEUE_KEY = 'doudizhu:match:queue';
const PLAYER_KEY = (pid: string) => `doudizhu:match:player:${pid}`;
const MATCH_SIZE = 3;
const POWER_RANGE = 0.25; // 战力差距上限 25%

/**
 * 斗地主 3 人匹配（最小增量，独立于通用 2 人 matchmaking）：
 * 入队即按战力排序尝试组局，凑齐 3 人即开（空位由桌态服务补 AI）。
 * 撮合成功后由 DoudizhuTableService.createMatchTable 建 NET 桌并立即开局。
 */
@Injectable()
export class DoudizhuMatchService {
  private readonly logger = new Logger(DoudizhuMatchService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly eventBus: EventBusService,
    private readonly table: DoudizhuTableService,
  ) {}

  async join(
    playerId: string,
    combatPower: number,
  ): Promise<{ queued: boolean; position: number }> {
    const exists = await this.cache.exists(PLAYER_KEY(playerId));
    if (exists) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '已在匹配队列中');
    }
    await this.cache.zAdd(QUEUE_KEY, combatPower, playerId);
    await this.cache.hSet(
      PLAYER_KEY(playerId),
      'score',
      combatPower.toString(),
    );
    await this.cache.expire(PLAYER_KEY(playerId), 600);
    await this.tryFormGroup();
    const queue = await this.cache.zRange(QUEUE_KEY, 0, -1);
    return { queued: true, position: queue.length };
  }

  async cancel(playerId: string): Promise<{ cancelled: boolean }> {
    const exists = await this.cache.exists(PLAYER_KEY(playerId));
    if (!exists) return { cancelled: false };
    await this.cache.zRem(QUEUE_KEY, playerId);
    await this.cache.del(PLAYER_KEY(playerId));
    return { cancelled: true };
  }

  async status(
    playerId: string,
  ): Promise<{ inQueue: boolean; position?: number }> {
    const exists = await this.cache.exists(PLAYER_KEY(playerId));
    if (!exists) return { inQueue: false };
    const queue = await this.cache.zRange(QUEUE_KEY, 0, -1);
    const position = queue.indexOf(playerId);
    return {
      inQueue: true,
      position: position >= 0 ? position + 1 : undefined,
    };
  }

  /** 战力排序取前 3，校验战力相近后原子移除（避免并发重复匹配），成功即建桌 */
  private async tryFormGroup(): Promise<void> {
    const queue = await this.cache.zRange(QUEUE_KEY, 0, -1);
    if (queue.length < MATCH_SIZE) return;
    const group = queue.slice(0, MATCH_SIZE);
    const scores = await Promise.all(
      group.map((p) =>
        this.cache.hGet(PLAYER_KEY(p), 'score').then((s) => Number(s) || 0),
      ),
    );
    const lo = Math.min(...scores);
    const hi = Math.max(...scores);
    if (lo > 0 && hi / lo > 1 + POWER_RANGE) return; // 战力差距过大，等更接近的玩家

    const removed = await this.cache.zRem(QUEUE_KEY, ...group);
    if (removed < MATCH_SIZE) return; // 并发被抢，放弃本次撮合
    for (const p of group) await this.cache.del(PLAYER_KEY(p));

    const tableId = await this.table.createMatchTable(group, 'normal');
    this.eventBus.emit(GameEvents.DOUDIZHU_MATCHED, {
      tableId,
      players: group,
    });
    this.logger.log(`[Doudizhu match] ${group.join(',')} -> ${tableId}`);
  }
}
