import { NpcTickService } from './npc-tick.service';
import { NpcPresenceService, NpcInstance } from './npc-presence.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameGateway } from '@modules/gateway/game.gateway';

/** 构造一个已位移的 NPC 实例 */
const makeNpc = (overrides: Partial<NpcInstance> = {}): NpcInstance => ({
  npcId: 'npcs:9:0',
  npcTemplateId: '5',
  resKey: 'npc_guard',
  name: '守卫',
  scale: 1,
  anim: 'walk',
  x: 120,
  y: 80,
  ...overrides,
});

describe('NpcTickService', () => {
  let service: NpcTickService;
  let npcPresence: { advanceTick: jest.Mock };
  let cacheService: { sMembers: jest.Mock };
  let eventBus: { emit: jest.Mock };

  beforeEach(() => {
    npcPresence = { advanceTick: jest.fn() };
    cacheService = { sMembers: jest.fn().mockResolvedValue([]) };
    eventBus = { emit: jest.fn() };
    service = new NpcTickService(
      npcPresence as unknown as NpcPresenceService,
      cacheService as unknown as CacheService,
      eventBus as unknown as EventBusService,
    );
  });

  it('① 无活跃场景时不推进、不广播（A6/D7）', async () => {
    cacheService.sMembers.mockResolvedValue([]);

    await service.tick();

    expect(npcPresence.advanceTick).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('② 场景有位移时推进并 emit（payload 结构正确）', async () => {
    cacheService.sMembers.mockResolvedValue(['1']);
    npcPresence.advanceTick.mockResolvedValue([
      { sceneId: '1', npcs: [makeNpc()] },
    ]);

    await service.tick();

    expect(npcPresence.advanceTick).toHaveBeenCalledWith(['1']);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const [event, payload] = eventBus.emit.mock.calls[0];
    expect(event).toBe(GameEvents.NPC_POSITIONS_UPDATED);
    expect(payload).toEqual({
      sceneId: '1',
      npcs: [
        {
          npcId: 'npcs:9:0',
          npcTemplateId: '5',
          x: 120,
          y: 80,
          rotation: 0,
          state: 'move',
        },
      ],
    });
  });

  it('③ 场景无位移（npcs 为空）时不 emit', async () => {
    cacheService.sMembers.mockResolvedValue(['1']);
    npcPresence.advanceTick.mockResolvedValue([{ sceneId: '1', npcs: [] }]);

    await service.tick();

    expect(npcPresence.advanceTick).toHaveBeenCalledWith(['1']);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('④ 单场景异常被捕获，后续场景仍处理且 running 复位', async () => {
    cacheService.sMembers.mockResolvedValue(['1', '2']);
    npcPresence.advanceTick.mockImplementation((sceneIds: string[]) => {
      if (sceneIds[0] === '1') return Promise.reject(new Error('boom'));
      return Promise.resolve([{ sceneId: '2', npcs: [makeNpc()] }]);
    });

    await service.tick();

    // 场景 2 未被场景 1 的异常中断
    expect(npcPresence.advanceTick).toHaveBeenCalledTimes(2);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit.mock.calls[0][1].sceneId).toBe('2');

    // running 已复位：再次 tick 仍能正常执行
    npcPresence.advanceTick.mockClear();
    eventBus.emit.mockClear();
    await service.tick();
    expect(npcPresence.advanceTick).toHaveBeenCalledTimes(2);
  });

  it('⑤ 上一轮未结束时跳过本轮（互斥，风险 #8）', async () => {
    cacheService.sMembers.mockResolvedValue(['1']);
    // 第一轮挂起不结束
    npcPresence.advanceTick.mockImplementation(() => new Promise(() => {}));

    void service.tick();
    await service.tick();

    expect(cacheService.sMembers).toHaveBeenCalledTimes(1);
  });
});

describe('GameGateway NPC 位置广播', () => {
  let gateway: GameGateway;
  let emit: jest.Mock;
  let to: jest.Mock;

  const buildGateway = (roomSize: number) => {
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    const g = new GameGateway(
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
    );
    g.setServer({
      to,
      // 命名空间网关：房间表在 adapter.rooms 上（见 gateway 注释）
      adapter: { rooms: new Map([['scene:1', { size: roomSize }]]) },
    } as any);
    return g;
  };

  it('⑥ 广播包与玩家包结构一致（entityId/entityType/pos，entityType=npc）', () => {
    gateway = buildGateway(2);

    gateway.handleNpcPositions({
      sceneId: '1',
      npcs: [{ npcId: 'npcs:9:0', npcTemplateId: '5', x: 120, y: 80 }],
    });

    expect(to).toHaveBeenCalledWith('scene:1');
    expect(emit).toHaveBeenCalledWith('message', {
      cmd: 'world.entity_update',
      seq: 0,
      code: 0,
      msg: 'success',
      data: {
        entityId: 'npcs:9:0',
        entityType: 'npc',
        npcTemplateId: '5',
        pos: { x: 120, y: 80 },
        rotation: 0,
        state: 'move',
      },
    });
  });

  it('⑦ 房间为空时不广播（A6 双重保险）', () => {
    gateway = buildGateway(0);

    gateway.handleNpcPositions({
      sceneId: '1',
      npcs: [{ npcId: 'npcs:9:0', npcTemplateId: '5', x: 120, y: 80 }],
    });

    expect(emit).not.toHaveBeenCalled();
  });
});
