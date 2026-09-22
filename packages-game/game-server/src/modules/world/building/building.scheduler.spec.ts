import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BuildingScheduler } from './building.scheduler';
import { BuildRuleService } from './build-rule.service';
import { BuildingService } from './building.service';
import { BuildingInstance } from '../entities/building-instance.entity';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { BuildMode, BuildingState } from '@constants/enums';

const SCENE_ID = '7';
const PLAYER_ID = '1001';
const GRID_SIZE = 64;

describe('BuildingScheduler', () => {
  let scheduler: BuildingScheduler;
  let buildingRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let cacheService: { withLock: jest.Mock };
  let eventBus: { emit: jest.Mock };
  let buildRule: { getRule: jest.Mock; toCenter: jest.Mock };
  let buildingService: { refundExpiredCoop: jest.Mock };
  let loggerErrorSpy: jest.SpyInstance;

  const past = new Date('2026-01-01T00:00:00.000Z');
  const future = new Date('2999-01-01T00:00:00.000Z');

  const makeRow = (overrides: Record<string, any> = {}): any => ({
    id: '1',
    sceneId: SCENE_ID,
    templateId: '55',
    plotId: '1',
    ownerId: PLAYER_ID,
    state: BuildingState.BUILDING,
    finishAt: past,
    payload: { gx: 1, gy: 1, w: 1, h: 1 },
    ...overrides,
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    buildingRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (entity: any) => entity),
    };
    cacheService = {
      withLock: jest.fn(async (_key: string, cb: () => Promise<any>) => cb()),
    };
    eventBus = { emit: jest.fn() };
    buildRule = {
      getRule: jest.fn().mockResolvedValue({
        id: '9',
        sceneId: SCENE_ID,
        mode: BuildMode.SOLO,
        landGridSize: GRID_SIZE,
        maxBuildingsPerPlayer: 5,
        allowDemolish: true,
        coopMinContributors: 2,
        coopExpireHours: 24,
        reservedZones: [],
      }),
      toCenter: jest.fn((gx: number, gy: number, size: number) => ({
        x: (gx + 0.5) * size,
        y: (gy + 0.5) * size,
      })),
    };
    buildingService = {
      refundExpiredCoop: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuildingScheduler,
        {
          provide: getRepositoryToken(BuildingInstance),
          useValue: buildingRepo,
        },
        { provide: CacheService, useValue: cacheService },
        { provide: EventBusService, useValue: eventBus },
        { provide: BuildRuleService, useValue: buildRule },
        { provide: BuildingService, useValue: buildingService },
      ],
    }).compile();

    scheduler = module.get(BuildingScheduler);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('到期建筑置 BUILT 并发事件', async () => {
    const row = makeRow();
    buildingRepo.find.mockResolvedValue([row]);
    buildingRepo.findOne.mockResolvedValue({ ...row });

    await scheduler.reconcile();

    // 两步各查一次（落成结算 + 共建超时退款）
    expect(buildingRepo.find).toHaveBeenCalledTimes(2);
    expect(buildingRepo.save).toHaveBeenCalledTimes(1);
    expect(buildingRepo.save.mock.calls[0][0].state).toBe(BuildingState.BUILT);

    expect(cacheService.withLock).toHaveBeenCalledWith(
      'lock:building:1',
      expect.any(Function),
      { ttl: 10, retry: 2, retryDelay: 100 },
    );

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const [event, payload] = eventBus.emit.mock.calls[0];
    expect(event).toBe(GameEvents.BUILDING_STATE_CHANGED);
    expect(payload).toMatchObject({
      sceneId: SCENE_ID,
      buildingId: '1',
      templateId: '55',
      ownerId: PLAYER_ID,
      state: BuildingState.BUILT,
      rotation: 0,
    });
    expect(payload.x).toBe((1 + 0.5) * GRID_SIZE);
    expect(payload.y).toBe((1 + 0.5) * GRID_SIZE);
  });

  it('幂等：锁内重读发现已 BUILT → 不重复 save、不重复 emit', async () => {
    const row = makeRow();
    buildingRepo.find.mockResolvedValue([row]);
    // 锁内重读拿到已落成状态（并发/重复执行场景）
    buildingRepo.findOne.mockResolvedValue({
      ...row,
      state: BuildingState.BUILT,
    });

    await scheduler.reconcile();

    expect(buildingRepo.save).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('finish_at > now → 不动', async () => {
    const row = makeRow({ finishAt: future });
    buildingRepo.find.mockResolvedValue([row]);
    buildingRepo.findOne.mockResolvedValue({ ...row });

    await scheduler.reconcile();

    expect(buildingRepo.save).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('单行抢锁失败 → 记 error 且不影响其余行', async () => {
    const row1 = makeRow({ id: '1' });
    const row2 = makeRow({ id: '2' });
    buildingRepo.find.mockResolvedValue([row1, row2]);
    buildingRepo.findOne.mockImplementation(async ({ where }: any) =>
      where.id === '1' ? { ...row1 } : { ...row2 },
    );
    cacheService.withLock.mockImplementation(
      async (key: string, cb: () => Promise<any>) => {
        if (key === 'lock:building:1') {
          throw new Error('Failed to acquire lock: lock:building:1');
        }
        return cb();
      },
    );

    await scheduler.reconcile();

    // 第一行失败被记录
    expect(loggerErrorSpy).toHaveBeenCalled();
    // 第二行仍正常落成并发事件
    expect(buildingRepo.save).toHaveBeenCalledTimes(1);
    expect(buildingRepo.save.mock.calls[0][0].id).toBe('2');
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit.mock.calls[0][1].buildingId).toBe('2');
  });

  it('running 互斥：上一轮未完时跳过本轮', async () => {
    // 首次查询挂起，制造「上一轮未结束」状态
    let release: (v: any) => void = () => undefined;
    let calls = 0;
    buildingRepo.find.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve([]);
    });

    const first = scheduler.reconcile();
    await scheduler.reconcile(); // 第二轮应被跳过
    expect(calls).toBe(1); // 第二轮未触发任何查询
    release([]);
    await first;
    expect(calls).toBe(2); // 仅第一轮的第二步（超时退款）再查一次
  });

  // ===== Task 4：共建行不误落成 + 超时退款 =====
  it('共建未达标行：跳过落成，改调 refundExpiredCoop（不误落成）', async () => {
    const row = makeRow({
      payload: { gx: 1, gy: 1, w: 1, h: 1, coop: true, reached: false },
    });
    buildingRepo.find.mockResolvedValue([row]);

    await scheduler.reconcile();

    expect(buildingRepo.save).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(buildingService.refundExpiredCoop).toHaveBeenCalledTimes(1);
    expect(buildingService.refundExpiredCoop).toHaveBeenCalledWith('1');
    expect(cacheService.withLock).toHaveBeenCalledWith(
      'lock:building:1',
      expect.any(Function),
      { ttl: 10, retry: 2, retryDelay: 100 },
    );
  });

  it('共建已达标行：不退款，按到期正常落成', async () => {
    const row = makeRow({
      payload: { gx: 1, gy: 1, w: 1, h: 1, coop: true, reached: true },
    });
    buildingRepo.find.mockResolvedValue([row]);
    buildingRepo.findOne.mockResolvedValue({ ...row });

    await scheduler.reconcile();

    expect(buildingRepo.save).toHaveBeenCalledTimes(1);
    expect(buildingRepo.save.mock.calls[0][0].state).toBe(BuildingState.BUILT);
    expect(buildingService.refundExpiredCoop).not.toHaveBeenCalled();
  });

  it('共建未达标但未到期：既不落成也不退款', async () => {
    const row = makeRow({
      finishAt: future,
      payload: { gx: 1, gy: 1, w: 1, h: 1, coop: true, reached: false },
    });
    // 步骤一/二都以 finish_at<=now 查询，故模拟查询返回空
    buildingRepo.find.mockResolvedValue([]);

    await scheduler.reconcile();

    expect(buildingRepo.save).not.toHaveBeenCalled();
    expect(buildingService.refundExpiredCoop).not.toHaveBeenCalled();
    expect(row.payload.reached).toBe(false);
  });

  it('共建退款失败：记 error 且不影响其余行', async () => {
    const row1 = makeRow({
      id: '1',
      payload: { gx: 1, gy: 1, w: 1, h: 1, coop: true, reached: false },
    });
    const row2 = makeRow({
      id: '2',
      payload: { gx: 2, gy: 1, w: 1, h: 1, coop: true, reached: false },
    });
    buildingRepo.find.mockResolvedValue([row1, row2]);
    buildingService.refundExpiredCoop.mockImplementation(async (id: string) => {
      if (id === '1') throw new Error('BAG_FULL');
    });

    await scheduler.reconcile();

    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(buildingService.refundExpiredCoop).toHaveBeenCalledTimes(2);
    expect(buildingService.refundExpiredCoop.mock.calls.map((c) => c[0])).toEqual(
      ['1', '2'],
    );
  });
});