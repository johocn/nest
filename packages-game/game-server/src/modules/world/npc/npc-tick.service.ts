import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { ACTIVE_SCENES_KEY } from '../world.service';
import { NpcPresenceService } from './npc-presence.service';

/** 位置校正广播载荷（gateway 据此向 scene:<id> 房间广播 world.entity_update） */
export interface NpcPositionsUpdatedPayload {
  sceneId: string;
  npcs: Array<{
    npcId: string;
    npcTemplateId: string;
    x: number;
    y: number;
    rotation?: number;
    state?: string;
  }>;
}

/**
 * NPC 位置低频推进与校正广播（S4）。
 *
 * - 每 2 秒跑一次（`@Cron` 表达式静态，间隔固定）；每轮模拟时长由
 *   `NpcPresenceService.advanceTick` 内部解析 `NPC_TICK_MS`（默认 2000ms）；
 * - 只跑「有玩家在场」的场景（D7），空场景不空转、不广播（A6）；
 * - 只广播本次确实发生位移的实例；单场景异常不中断后续场景（风险 #8）；
 * - 广播经 EventBus 解耦（D4），不注入 gateway，避免模块循环依赖。
 */
@Injectable()
export class NpcTickService {
  private readonly logger = new Logger(NpcTickService.name);

  /** 互斥标记：上一轮未结束则跳过本轮，避免 tick 堆积（风险 #8） */
  private running = false;

  constructor(
    private readonly npcPresence: NpcPresenceService,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
  ) {}

  @Cron('*/2 * * * * *')
  async tick(): Promise<void> {
    if (this.running) {
      this.logger.debug('上一轮 NPC tick 尚未结束，跳过本轮');
      return;
    }
    this.running = true;
    try {
      // D7/A6：只推进有玩家在场的场景，空场景直接返回、不 emit
      const sceneIds = await this.cacheService.sMembers(ACTIVE_SCENES_KEY);
      if (sceneIds.length === 0) return;

      for (const sceneId of sceneIds) {
        try {
          const [r] = await this.npcPresence.advanceTick([sceneId]);
          if (!r || r.npcs.length === 0) continue;
          this.eventBus.emit(GameEvents.NPC_POSITIONS_UPDATED, {
            sceneId,
            npcs: r.npcs.map((npc) => ({
              npcId: npc.npcId,
              npcTemplateId: npc.npcTemplateId,
              x: npc.x,
              y: npc.y,
              rotation: 0,
              state: 'move',
            })),
          } satisfies NpcPositionsUpdatedPayload);
        } catch (err) {
          // 单场景失败不影响其余场景
          this.logger.error(
            `NPC tick 场景 ${sceneId} 推进失败`,
            (err as Error).message,
          );
        }
      }
    } catch (err) {
      this.logger.error('NPC tick 执行失败', (err as Error).message);
    } finally {
      this.running = false;
    }
  }
}
