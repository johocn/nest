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
import { BuildingService, BuildingStateChangedPayload } from './building.service';

/**
 * 建筑结算定时器（S6 / Task 3、Task 4）。
 *
 * 每分钟扫描 state='building' 且 finish_at<=now 的实例，顺序执行两步：
 *  1. 落成结算：跳过「共建未达标」行（payload.coop && !payload.reached），
 *     其余逐行加锁后**重新读取**并二次判定状态，幂等落成并发事件；
 *  2. 共建超时退款：对「共建未达标且已超时」行逐行加锁调 BuildingService.refundExpiredCoop。
 * 单行失败不影响其余行；退款失败由 service 抛出，本处仅记日志（下一 tick 重试）。
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
    private readonly buildingService: BuildingService,
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
      // 第二步：共建超时退款（与落成结算同一 tick，避免 2G 服务器被定时任务压垮）
      await this.refundExpiredCoopBuildings();
    } catch (err) {
      this.logger.error('建筑结算执行失败', (err as Error).message);
    } finally {
      this.running = false;
    }
  }

  /** 步骤一：把已到期的 building 置为 built（幂等）；共建未达标行跳过 */
  private async settleFinishedBuildings(): Promise<void> {
    const rows = await this.buildingRepo.find({
      where: {
        state: BuildingState.BUILDING,
        finishAt: LessThanOrEqual(new Date()),
      },
    });
    for (const row of rows) {
      // 共建未达标：finish_at 为「超时时刻」而非落成时刻，交由步骤二退款，禁止误落成
      const payload = row.payload ?? {};
      if (payload.coop === true && payload.reached !== true) {
        continue;
      }
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

  /**
   * 步骤二：共建未达标且已超时 → 逐行加锁退款。
   * 锁内由 service 重读并二次判定（幂等）；退款失败记日志，下一 tick 重试。
   */
  private async refundExpiredCoopBuildings(): Promise<void> {
    const rows = await this.buildingRepo.find({
      where: {
        state: BuildingState.BUILDING,
        finishAt: LessThanOrEqual(new Date()),
      },
    });
    for (const row of rows) {
      const payload = row.payload ?? {};
      if (payload.coop !== true || payload.reached === true) {
        continue;
      }
      try {
        await this.cacheService.withLock(
          `lock:building:${row.id}`,
          async () => {
            await this.buildingService.refundExpiredCoop(row.id);
          },
          { ttl: 10, retry: 2, retryDelay: 100 },
        );
      } catch (err) {
        // 退款失败（如 BAG_FULL）：记 error，不吞异常，下一 tick 重试
        this.logger.error(
          `共建 ${row.id} 超时退款失败`,
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