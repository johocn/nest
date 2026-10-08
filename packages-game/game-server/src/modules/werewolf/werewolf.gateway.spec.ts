import { WerewolfGateway } from './werewolf.gateway';

/** 假 socket.io Server：记录每次 to(room).emit(event, payload) */
function fakeServer() {
  const emits: { room: string; ev: string; payload: any }[] = [];
  const server = {
    emits,
    to(room: string) {
      return {
        emit: (ev: string, payload: any) => {
          emits.push({ room, ev, payload });
          return true;
        },
      };
    },
  };
  return server;
}

function makeGateway(online: Record<string, string | null> = {}) {
  const svc = {
    createRoom: jest.fn(() => ({ step: 'lobby' })),
    joinRoom: jest.fn(() => ({ step: 'lobby' })),
    leaveRoom: jest.fn(),
    startRoom: jest.fn(() => ({ step: 'night_begin' })),
    submitAction: jest.fn(() => ({ seat: 0 })),
    devFillRoom: jest.fn(() => ({ players: 9 })),
    say: jest.fn(() => ({ step: 'day_discuss' })),
  };
  const conn = {
    getPlayerConnection: async (pid: string) => {
      const socketId = online[pid] ?? null;
      return socketId ? { socketId } : null;
    },
  };
  const server = fakeServer();
  const gw = new WerewolfGateway(svc as any, conn as any);
  (gw as any).server = server;
  return { gw, svc, conn, server };
}

const client = (playerId?: string) =>
  ({ data: playerId ? { playerId } : {} }) as any;

describe('WerewolfGateway', () => {
  it('未认证连接返回 401，且不调用 service', () => {
    const { gw, svc } = makeGateway();
    const res = gw.handleCreate(client(), {
      cmd: 'werewolf.create',
      seq: 1,
      data: {},
    });
    expect(res.code).toBe(401);
    expect(svc.createRoom).not.toHaveBeenCalled();
  });

  it('werewolf.create：以连接上的 playerId 作为房主，返回 roomId', () => {
    const { gw, svc } = makeGateway();
    const res = gw.handleCreate(client('P0'), {
      cmd: 'werewolf.create',
      seq: 7,
      data: { name: '张三', playerCount: 9 },
    });
    expect(res.code).toBe(0);
    expect(res.seq).toBe(7);
    expect(res.data.roomId).toBeTruthy();
    expect(svc.createRoom).toHaveBeenCalledTimes(1);
    expect(svc.createRoom.mock.calls[0][0]).toMatchObject({
      hostPlayerId: 'P0',
      hostName: '张三',
      playerCount: 9,
    });
  });

  it('werewolf.action：把 roomId/playerId/payload 正确透传给 service', () => {
    const { gw, svc } = makeGateway();
    const res = gw.handleAction(client('P5'), {
      cmd: 'werewolf.action',
      seq: 2,
      data: { roomId: 'r1', payload: { targetSeat: 3 } },
    });
    expect(res.code).toBe(0);
    expect(svc.submitAction).toHaveBeenCalledWith('r1', 'P5', {
      targetSeat: 3,
    });
  });

  it('werewolf.start / join / leave / dev_fill 均正确转发', () => {
    const { gw, svc } = makeGateway();
    gw.handleStart(client('H'), {
      cmd: 'werewolf.start',
      seq: 1,
      data: { roomId: 'r1' },
    });
    expect(svc.startRoom).toHaveBeenCalledWith('r1', 'H');

    gw.handleJoin(client('P1'), {
      cmd: 'werewolf.join',
      seq: 1,
      data: { roomId: 'r1', name: '李四' },
    });
    expect(svc.joinRoom).toHaveBeenCalledWith('r1', 'P1', '李四');

    gw.handleLeave(client('P1'), {
      cmd: 'werewolf.leave',
      seq: 1,
      data: { roomId: 'r1' },
    });
    expect(svc.leaveRoom).toHaveBeenCalledWith('r1', 'P1');

    gw.handleDevFill(client('H'), {
      cmd: 'werewolf.dev_fill',
      seq: 1,
      data: { roomId: 'r1', count: 8 },
    });
    expect(svc.devFillRoom).toHaveBeenCalledWith('r1', 'H', 8);
  });

  it('werewolf.say：把 roomId/playerId/text 正确透传给 service', () => {
    const { gw, svc } = makeGateway();
    const res = gw.handleSay(client('P0'), {
      cmd: 'werewolf.say',
      seq: 3,
      data: { roomId: 'r1', text: '我怀疑 3 号' },
    });
    expect(res.code).toBe(0);
    expect(svc.say).toHaveBeenCalledWith('r1', 'P0', '我怀疑 3 号');
  });

  it('werewolf.say：未认证返回 401', () => {
    const { gw, svc } = makeGateway();
    const res = gw.handleSay(client(), {
      cmd: 'werewolf.say',
      seq: 1,
      data: { roomId: 'r1', text: 'hi' },
    });
    expect(res.code).toBe(401);
    expect(svc.say).not.toHaveBeenCalled();
  });

  it('广播：向每个在线玩家的 socket 推送各自的私有视图，离线玩家跳过', async () => {
    // P2 在线映射为 null → 模拟离线
    const { gw, server } = makeGateway({
      P0: 'sock_P0',
      P1: 'sock_P1',
      P2: null,
    });
    const pub = { step: 'night_wolf', cycle: 1 };
    const privates = {
      P0: { seat: 0, canAct: true },
      P1: { seat: 1, canAct: false },
      P2: { seat: 2 },
    };

    await gw.onBroadcast({ roomId: 'r1', public: pub, privates });

    expect(server.emits).toHaveLength(2);
    expect(server.emits.map((e) => e.room).sort()).toEqual([
      'sock_P0',
      'sock_P1',
    ]);
    for (const e of server.emits) {
      expect(e.ev).toBe('message');
      expect(e.payload.cmd).toBe('werewolf.sync');
      expect(e.payload.code).toBe(0);
      expect(e.payload.data.public).toEqual(pub);
    }
    const byRoom = Object.fromEntries(
      server.emits.map((e) => [e.room, e.payload.data.private]),
    );
    expect(byRoom['sock_P0']).toEqual(privates.P0);
    expect(byRoom['sock_P1']).toEqual(privates.P1);
  });
});
