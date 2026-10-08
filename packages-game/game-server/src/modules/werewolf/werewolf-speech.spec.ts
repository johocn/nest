import { WerewolfRoom } from './werewolf-room';
import { WerewolfRole, WerewolfStep } from './werewolf.constants';
import { CreateRoomOptions, WerewolfPlayer } from './werewolf.types';

const NOW = 1_000_000;

const FIXED_ROLES: WerewolfRole[] = [
  WerewolfRole.WEREWOLF,
  WerewolfRole.WEREWOLF,
  WerewolfRole.WEREWOLF,
  WerewolfRole.SEER,
  WerewolfRole.WITCH,
  WerewolfRole.HUNTER,
  WerewolfRole.GUARD,
  WerewolfRole.VILLAGER,
  WerewolfRole.VILLAGER,
];

function makeRoom(): WerewolfRoom {
  const opts: CreateRoomOptions = {
    roomId: 'speech-room',
    hostPlayerId: 'P0',
    hostName: 'P0',
    roles: FIXED_ROLES,
  };
  const room = new WerewolfRoom(opts);
  for (let i = 1; i < 9; i++) room.addPlayer(`P${i}`, `P${i}`);
  return room;
}

function advanceTo(room: WerewolfRoom, step: WerewolfStep): void {
  let guard = 0;
  while (
    room.step !== step &&
    room.step !== WerewolfStep.GAME_OVER &&
    guard++ < 60
  ) {
    room.timeout(NOW);
  }
}

/** 白天投票放逐一名村民（避免触发猎人开枪），返回被放逐者 */
function voteOutVillager(room: WerewolfRoom): WerewolfPlayer {
  advanceTo(room, WerewolfStep.DAY_VOTE);
  const target = room.players.find(
    (p) => p.alive && p.role === WerewolfRole.VILLAGER,
  )!;
  const other = room.players.find((p) => p.alive && p.seat !== target.seat)!;
  for (const p of room.players.filter((x) => x.alive)) {
    room.submitAction(
      p.playerId,
      { targetSeat: p.seat === target.seat ? other.seat : target.seat },
      NOW,
    );
  }
  return target;
}

describe('狼人杀发言 / 遗言', () => {
  it('白天讨论阶段：存活玩家可发言，进入公共快照', () => {
    const room = makeRoom();
    room.start();
    advanceTo(room, WerewolfStep.DAY_DISCUSS);
    expect(room.step).toBe(WerewolfStep.DAY_DISCUSS);

    const p = room.players[0];
    expect(room.say(p.playerId, '我怀疑 3 号')).toBeUndefined();

    const msgs = room.getPublicSnapshot().messages;
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[msgs.length - 1]).toMatchObject({
      seat: p.seat,
      name: p.name,
      text: '我怀疑 3 号',
      kind: 'speech',
    });
  });

  it('夜晚阶段：存活玩家不可发言', () => {
    const room = makeRoom();
    room.start();
    advanceTo(room, WerewolfStep.NIGHT_WOLF);

    const p = room.players.find((x) => x.alive)!;
    expect(room.say(p.playerId, '夜里说话')).toBe('WEREWOLF_CANNOT_SPEAK');
    expect(room.getPrivateView(p.playerId).canSpeak).toBe(false);
  });

  it('空内容或纯空白被拒绝', () => {
    const room = makeRoom();
    room.start();
    advanceTo(room, WerewolfStep.DAY_DISCUSS);
    const p = room.players[0];
    expect(room.say(p.playerId, '   ')).toBe('WEREWOLF_EMPTY_MESSAGE');
    expect(
      room.getPublicSnapshot().messages.some((m) => m.kind === 'speech'),
    ).toBe(false);
  });

  it('出局时产生系统公告', () => {
    const room = makeRoom();
    room.start();
    const dead = voteOutVillager(room);
    expect(dead.alive).toBe(false);

    const msgs = room.getPublicSnapshot().messages;
    expect(msgs.some((m) => m.kind === 'system' && m.seat === dead.seat)).toBe(
      true,
    );
  });

  it('出局玩家可留一次遗言，第二次被拒', () => {
    const room = makeRoom();
    room.start();
    const dead = voteOutVillager(room);
    // 放逐结算后停留在 DAY_RESULT（遗言窗口内）
    expect(room.step).toBe(WerewolfStep.DAY_RESULT);

    expect(room.getPrivateView(dead.playerId).canLastWords).toBe(true);
    expect(room.say(dead.playerId, '我是好人，别投我')).toBeUndefined();

    const msgs = room.getPublicSnapshot().messages;
    expect(msgs[msgs.length - 1]).toMatchObject({
      seat: dead.seat,
      text: '我是好人，别投我',
      kind: 'lastwords',
    });

    // 遗言仅一次
    expect(room.say(dead.playerId, '再补一句')).toBe('WEREWOLF_CANNOT_SPEAK');
    expect(room.getPrivateView(dead.playerId).canLastWords).toBe(false);
  });

  it('存活玩家不能发遗言；非遗言窗口的出局玩家也不能发言', () => {
    const room = makeRoom();
    room.start();
    advanceTo(room, WerewolfStep.DAY_DISCUSS);
    const alive = room.players.find((p) => p.alive)!;
    expect(room.getPrivateView(alive.playerId).canLastWords).toBe(false);
    expect(room.getPrivateView(alive.playerId).canSpeak).toBe(true);

    const dead = voteOutVillager(room);
    expect(room.step).toBe(WerewolfStep.DAY_RESULT);
    // 推进到下一回合后，遗言窗口关闭
    advanceTo(room, WerewolfStep.DAY_VOTE);
    room.timeout(NOW);
    room.timeout(NOW);
    expect(room.getPrivateView(dead.playerId).canLastWords).toBe(false);
    expect(room.say(dead.playerId, '还能说吗')).toBe('WEREWOLF_CANNOT_SPEAK');
  });

  it('不在房间内发言被拒', () => {
    const room = makeRoom();
    room.start();
    expect(room.say('陌生人', 'hi')).toBe('WEREWOLF_NOT_IN_ROOM');
  });
});
