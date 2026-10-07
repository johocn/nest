// 掼蛋集成层测试：GuandanTableService 的编排逻辑（建桌/加入/开局/出牌/AI 推进/视图/落库）
// 用内存假对象替换 CacheService / 仓库 / EventBus / PlayerService，真实跑引擎与进度循环。

import { GuandanTableService } from './guandan-table.service';
import { GuandanMode, GuandanTableStatus } from '@constants/enums';
import { ErrorCodes } from '@constants/error-codes';
import { chooseAction } from './engine/bot';
import { ActionDto } from './guandan.types';

// ===== 内存假依赖 =====
function makeCache() {
  const m: Record<string, string> = {};
  return {
    set: (k: string, v: string) => {
      m[k] = v;
      return Promise.resolve();
    },
    get: (k: string) => Promise.resolve(m[k] ?? null),
  };
}

function makeRoomRepo() {
  const rows: any[] = [];
  return {
    create: (d: any) => ({ ...d }),
    save: (r: any) => {
      const i = rows.findIndex((x) => x.tableId === r.tableId);
      if (i >= 0) rows[i] = r;
      else rows.push(r);
      return Promise.resolve(r);
    },
    findOne: ({ where }: any) => Promise.resolve(rows.find((r) => r.tableId === where.tableId) ?? null),
    find: ({ where }: any) => {
      const ids = where?.tableId;
      return Promise.resolve(
        rows.filter((r) => (Array.isArray(ids) ? ids.includes(r.tableId) : r.tableId === ids)),
      );
    },
  };
}

function makeRecordRepo() {
  const rows: any[] = [];
  return {
    create: (d: any) => ({ ...d }),
    save: (r: any) => {
      rows.push(r);
      return Promise.resolve(r);
    },
    find: ({ where, order, take }: any) => {
      let res = rows.filter((r) => r.playerId === where?.playerId);
      if (order?.createdAt === 'DESC') res = res.slice().reverse();
      if (take) res = res.slice(0, take);
      return Promise.resolve(res);
    },
  };
}

function makeEventBus() {
  return { emit: () => {}, on: () => {} };
}
function makePlayerService() {
  return { getById: (id: string) => Promise.resolve({ nickname: 'N' + id }) };
}

function makeService(opts?: { roomSaveFails?: boolean }) {
  const cache = makeCache();
  const roomRepo = makeRoomRepo();
  const recordRepo = makeRecordRepo();
  const eventBus = makeEventBus();
  const playerService = makePlayerService();
  if (opts?.roomSaveFails) {
    (roomRepo as any).save = () => Promise.reject(new Error('db down'));
  }
  const svc = new GuandanTableService(
    cache as any,
    roomRepo as any,
    recordRepo as any,
    eventBus as any,
    playerService as any,
  );
  return { svc, roomRepo, recordRepo };
}

// 由视图构造 chooseAction 所需的精简 GameState（仅需手牌/级数/规则/上一手）
function miniState(view: any, seat: number): any {
  return {
    players: view.players.map((p: any) => ({
      hand: p.hand,
      isOut: p.isOut,
      partnerSeat: p.partnerSeat,
      passedThisTrick: p.passed,
      finishOrder: p.finishOrder,
    })),
    level: view.state.level,
    rules: view.state.rules,
    turn: view.state.turn,
    lastPlay: view.state.lastPlay ? { seat: view.state.lastPlay.seat, combo: view.state.lastPlay.combo } : null,
  };
}

async function expectCode(fn: () => Promise<any>, code: number) {
  try {
    await fn();
    throw new Error('should have thrown');
  } catch (e: any) {
    const c = e?.response?.code ?? e?.getResponse?.()?.code ?? e?.code;
    expect(c).toBe(code);
  }
}

describe('GuandanTableService - 建桌与加入', () => {
  it('AI 模式：立即开局，房主 seat=0，自己手牌可见、他人隐藏但数量可见', async () => {
    const { svc } = makeService();
    const res = await svc.createTable('u1', GuandanMode.AI, 'sock1');
    expect(res.seat).toBe(0);
    expect(res.tableId).toMatch(/^guandan-/);
    const v = res.view;
    expect(v.yourSeat).toBe(0);
    expect(v.players[0].hand.length).toBe(25); // 自己手牌可见
    expect(v.players[1].hand.length).toBe(0); // 他人手牌隐藏
    expect(v.players[1].handCount).toBe(25); // 但数量可见
    expect(v.state.phase).toBe('play');
    expect(v.players[0].isBot).toBe(false);
    expect(v.players[1].isBot).toBe(true);
  });

  it('联网模式：4 人满员后自动补位开局', async () => {
    const { svc } = makeService();
    const t = await svc.createTable('h', GuandanMode.NET, 's0');
    const tid = t.tableId;
    await svc.joinTable(tid, 'p2', 's2');
    await svc.joinTable(tid, 'p3', 's3');
    const j3 = await svc.joinTable(tid, 'p4', 's4'); // 第 4 人 → 补位开局
    expect(j3.seat).toBe(3);
    const v = j3.view;
    expect(v.seated).toBe(4);
    expect(v.state.phase).toBe('play');
    expect(v.players.every((p: any) => !p.isBot)).toBe(true); // 4 真人均无 bot 补位
  });

  it('联网模式：满员后拒绝再加入', async () => {
    const { svc } = makeService();
    const t = await svc.createTable('h', GuandanMode.NET, 's0');
    const tid = t.tableId;
    await svc.joinTable(tid, 'p2', 's2');
    await svc.joinTable(tid, 'p3', 's3');
    await svc.joinTable(tid, 'p4', 's4');
    await expectCode(() => svc.joinTable(tid, 'p5', 's5'), ErrorCodes.GUANDAN_TABLE_FULL);
  });
});

describe('GuandanTableService - 出牌与 AI 推进', () => {
  it('房主出牌后 progress 自动跑完 AI 回合并交还控制权（不崩溃）', async () => {
    const { svc } = makeService();
    const host = 'u1';
    const t = await svc.createTable(host, GuandanMode.AI, 's0');
    const tid = t.tableId;
    const action = chooseAction(miniState(t.view, 0), 0);
    const r = await svc.applyAction(tid, host, { type: action.type, cards: action.cards } as ActionDto);
    expect(r.yourSeat).toBe(0);
    expect(r.players.length).toBe(4);
    // 要么回到房主回合，要么已分胜负
    expect(r.state.matchWinner != null || r.awaiting.includes(0)).toBe(true);
    // 首回合赢家会吃到底牌（+8）：房主手牌要么 25-出牌数，要么 25-出牌数+8（已吃底牌待弃）
    const played = action.type === 'play' ? action.cards.length : 0;
    expect([25 - played, 25 - played + 8]).toContain(r.players[0].hand.length);
  });

  it('落库失败（safePersist）不应中断对局', async () => {
    const { svc } = makeService({ roomSaveFails: true });
    const host = 'u1';
    const t = await svc.createTable(host, GuandanMode.AI, 's0');
    const tid = t.tableId;
    const action = chooseAction(miniState(t.view, 0), 0);
    // 若 safePersist 未吞掉异常，这里会抛错
    const r = await svc.applyAction(tid, host, { type: action.type, cards: action.cards } as ActionDto);
    expect(r).toBeTruthy();
    expect(r.players.length).toBe(4);
  });

  it('错误输入：牌桌不存在 / 玩家不在桌内 / 未开局，均抛对应错误', async () => {
    const { svc } = makeService();
    // 1) 牌桌不存在
    await expectCode(() => svc.applyAction('nope', 'u', { type: 'pass' }), ErrorCodes.GUANDAN_TABLE_NOT_FOUND);
    // 2) 玩家不在桌内：用已开局的 AI 桌（status=PLAYING），陌生人出牌
    const ai = await svc.createTable('h', GuandanMode.AI, 's0');
    await expectCode(
      () => svc.applyAction(ai.tableId, 'stranger', { type: 'pass' }),
      ErrorCodes.GUANDAN_PLAYER_NOT_IN_TABLE,
    );
    // 3) 未开局：联网模式 WAITING 时房主出牌
    const net = await svc.createTable('h', GuandanMode.NET, 's0');
    await expectCode(
      () => svc.applyAction(net.tableId, 'h', { type: 'pass' }),
      ErrorCodes.GUANDAN_INVALID_ACTION,
    );
  });
});

describe('GuandanTableService - 视角与历史', () => {
  it('viewBySeat：按座位构建视图，自己手牌可见', async () => {
    const { svc } = makeService();
    const host = 'u1';
    const t = await svc.createTable(host, GuandanMode.AI, 's0');
    const v = await svc.viewBySeat(t.tableId, 0);
    expect(v.yourSeat).toBe(0);
    expect(v.players[0].hand.length).toBe(25);
    expect(v.players[1].hand.length).toBe(0);
    // levelLabel 应有值
    expect(typeof v.state.levelLabel).toBe('string');
  });
});

describe('GuandanTableService - 完整对局（经 service 层驱动）', () => {
  it('AI 模式：驱动至分出冠军队，且房间落库为 FINISHED、产生战绩', async () => {
    const { svc, roomRepo } = makeService();
    const host = 'u1';
    const t = await svc.createTable(host, GuandanMode.AI, 's0');
    const tid = t.tableId;

    let guard = 0;
    while (guard++ < 5000) {
      const v = await svc.viewBySeat(tid, 0);
      if (v.state.matchWinner != null) break;
      if (v.awaiting.includes(0)) {
        const action = chooseAction(miniState(v, 0), 0);
        await svc.applyAction(tid, host, { type: action.type, cards: action.cards } as ActionDto);
      } else {
        // 房主已出完：触发剩余 bot 自动推进（单次 applyAction 内的 progress 会跑到底）
        const p0 = (await svc.viewBySeat(tid, 0)).players[0];
        if (!p0.isOut) break;
        const bseat = [1, 2, 3].find((i) => v.players[i].isBot) ?? 1;
        const bv = await svc.viewBySeat(tid, bseat);
        const a = chooseAction(miniState(bv, bseat), bseat);
        await svc.applyAction(tid, bv.players[bseat].playerId, { type: a.type, cards: a.cards } as ActionDto);
      }
    }

    const final = await svc.viewBySeat(tid, 0);
    expect(final.state.matchWinner).not.toBeNull();
    expect(final.state.phase).toBe('ended');

    const room = await roomRepo.findOne({ where: { tableId: tid } });
    expect(room?.status).toBe(GuandanTableStatus.FINISHED);

    const history = await svc.history(host);
    expect(history.length).toBeGreaterThan(0);
  });
});
