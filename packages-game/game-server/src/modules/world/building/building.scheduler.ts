import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThanOrEqual, Repository } from 'typeorm';
import { BuildingState } from '@constants/enums';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { BuildingInstance } from '../entities/building-instance.entity';
import { BuildRuleService } from './build-rule.service';
import { BuildingStateChangedPayload } from './building.service';

/**
 * 建筑结算定时器（S6 / Task 3）。
 *
 * 每分钟扫描 state='building' 且 finish_at<=now 的实例，
 * 逐行加锁后**重新读取**并二次判定状态，幂等落成并发事件。
 * 单行失败不影响其余行；Task 4 将在同一 tick 顺序挂载共建超时退款步骤。
 */
@Injectable()
export class BuildingScheduler {
  private readonly logger = new Logger(BuildingScheduler.name);

  /** 互斥标记：上一轮未结束则跳过本轮，避免 tick 堆积 */
  private running = false;

  constructor(
    @InjectRepository(BuildingInstance)
    private readonly buildingRepo: Repository<BuildingInstance>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
    private readonly buildRule: BuildRuleService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<void> {
    if (this.running) {
      this.logger.debug('上一轮建筑结算尚未结束，跳过本轮');
      return;
    }
    this.running = true;
    try {
      await this.settleFinishedBuildings();
      // Task 4 将在此处顺序追加共建超时退款步骤
    } catch (err) {
      this.logger.error('建筑结算执行失败', (err as Error).message);
    } finally {
      this.running = false;
    }
  }

  /** 步骤一：把已到期的 building 置为 built（幂等） */
  private async settleFinishedBuildings(): Promise<void> {
    const rows = await this.buildingRepo.find({
      where: {
        state: BuildingState.BUILDING,
        finishAt: LessThanOrEqual(new Date()),
      },
    });
    for (const row of rows) {
      try {
        await this.cacheService.withLock(
          `lock:building:${row.id}`,
          async () => {
            await this.settleOne(row.id);
          },
          { ttl: 10, retry: 2, retryDelay: 100 },
        );
      } catch (err) {
        // 单行失败（含抢锁失败）不影响其余行
        this.logger.error(
          `建筑 ${row.id} 落成结算失败`,
          (err as Error).message,
        );
      }
    }
  }

  /** 锁内结算单行：重新读取并二次判定，重复执行不重复落成/发事件 */
  private async settleOne(buildingId: string): Promise<void> {
    const building = await this.buildingRepo.findOne({
      where: { id: buildingId },
    });
    if (!building) return;
    if (building.state !== BuildingState.BUILDING) return;
    if (!building.finishAt || new Date(building.finishAt).getTime() > Date.now()) {
      return;
    }

    building.state = BuildingState.BUILT;
    await this.buildingRepo.save(building);

    const rule = await this.buildRule.getRule(building.sceneId);
    const payload = building.payload ?? {};
    const { x, y } = this.buildRule.toCenter(
      Number(payload.gx ?? 0),
      Number(payload.gy ?? 0),
      rule.landGridSize,
    );

    this.eventBus.emit(GameEvents.BUILDING_STATE_CHANGED, {
      sceneId: building.sceneId,
      buildingId: building.id,
      templateId: building.templateId,
      ownerId: building.ownerId,
      state: BuildingState.BUILT,
      x,
      y,
      rotation: 0,
    } satisfies BuildingStateChangedPayload);
  }
}