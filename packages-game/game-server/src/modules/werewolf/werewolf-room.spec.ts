import { WerewolfRoom } from './werewolf-room';
import { WerewolfRole, WerewolfStep } from './werewolf.constants';
import { CreateRoomOptions } from './werewolf.types';

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

function makeRoom(now = 1_000_000): WerewolfRoom {
  const opts: CreateRoomOptions = {
    roomId: 'test-room',
    hostPlayerId: 'P0',
    hostName: 'P0',
    roles: FIXED_ROLES,
  };
  const room = new WerewolfRoom(opts);
  for (let i = 1; i < 9; i++) room.addPlayer(`P${i}`, `P${i}`);
  return room;
}

const byRole = (room: WerewolfRoom, role: WerewolfRole) =>
  room.players.find((p) => p.role === role)!;
const wolves = (room: WerewolfRoom) =>
  room.players.filter((p) => p.role === WerewolfRole.WEREWOLF);

/** 把房间推进到指定阶段（跳过公告阶段） */
function advanceTo(room: WerewolfRoom, step: WerewolfStep, now: number): void {
  let guard = 0;
  while (
    room.step !== step &&
    room.step !== WerewolfStep.GAME_OVER &&
    guard++ < 60
  ) {
    room.timeout(now);
  }
}

describe('WerewolfRoom', () => {
  it('建房后随机分配角色，但角色构成与阵营正确', () => {
    const room = makeRoom();
    room.start();
    const roles = room.players.map((p) => p.role).sort();
    const expected = [...FIXED_ROLES].sort();
    expect(roles).toEqual(expected);
    expect(
      room.players.filter((p) => p.role === WerewolfRole.WEREWOLF).length,
    ).toBe(3);
    expect(byRole(room, WerewolfRole.SEER).camp).toBe('good');
    expect(byRole(room, WerewolfRole.WEREWOLF).camp).toBe('evil');
  });

  it('夜晚：狼刀被女巫解药+守卫双重救活', () => {
    const room = makeRoom();
    room.start();
    advanceTo(room, WerewolfStep.NIGHT_WOLF, 1_000_000);

    const victim = byRole(room, WerewolfRole.VILLAGER);
    for (const w of wolves(room)) {
      if (w.alive)
        room.submitAction(w.playerId, { targetSeat: victim.seat }, 1_000_000);
    }
    advanceTo(room, WerewolfStep.NIGHT_SEER, 1_000_000);
    const seer = byRole(room, WerewolfRole.SEER);
    const aWolf = wolves(room)[0];
    room.submitAction(seer.playerId, { targetSeat: aWolf.seat }, 1_000_000);
    advanceTo(room, WerewolfStep.NIGHT_WITCH, 1_000_000);

    room.submitAction(
      byRole(room, WerewolfRole.WITCH).playerId,
      { useAntidote: true },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.NIGHT_GUARD, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.GUARD).playerId,
      { targetSeat: victim.seat },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.NIGHT_END, 1_000_000);

    expect(room.players[victim.seat].alive).toBe(true);
    expect(room.deathsThisStep).toEqual([]);
    // 预言家应已知该狼为 evil
    expect(room.getPrivateView(seer.playerId).seerKnown[aWolf.seat]).toBe(
      'evil',
    );
  });

  it('夜晚：女巫毒药可击杀任意存活玩家（不可被守卫生效）', () => {
    const room = makeRoom();
    room.start();
    advanceTo(room, WerewolfStep.NIGHT_WOLF, 1_000_000);

    const villagers = room.players.filter(
      (p) => p.role === WerewolfRole.VILLAGER,
    );
    const target = villagers[1]; // 狼刀目标
    const poison = villagers[0]; // 毒杀目标
    for (const w of wolves(room)) {
      if (w.alive)
        room.submitAction(w.playerId, { targetSeat: target.seat }, 1_000_000);
    }
    advanceTo(room, WerewolfStep.NIGHT_SEER, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.SEER).playerId,
      { targetSeat: wolves(room)[0].seat },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.NIGHT_WITCH, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.WITCH).playerId,
      { usePoison: true, targetSeat: poison.seat },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.NIGHT_GUARD, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.GUARD).playerId,
      { targetSeat: target.seat },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.NIGHT_END, 1_000_000);

    // target 被守卫救下；poison 被毒死（毒不可挡）
    expect(room.players[target.seat].alive).toBe(true);
    expect(room.players[poison.seat].alive).toBe(false);
    expect(room.deathsThisStep).toContain(poison.seat);
  });

  it('白天：平票触发加投（revote），且本回合无人被放逐', () => {
    const room = makeRoom();
    room.start();
    // 走完一个无死亡的夜晚（全员保同一平民）
    advanceTo(room, WerewolfStep.NIGHT_WOLF, 1_000_000);
    const victim = byRole(room, WerewolfRole.VILLAGER);
    for (const w of wolves(room)) {
      if (w.alive)
        room.submitAction(w.playerId, { targetSeat: victim.seat }, 1_000_000);
    }
    advanceTo(room, WerewolfStep.NIGHT_SEER, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.SEER).playerId,
      { targetSeat: wolves(room)[0].seat },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.NIGHT_WITCH, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.WITCH).playerId,
      { useAntidote: true },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.NIGHT_GUARD, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.GUARD).playerId,
      { targetSeat: victim.seat },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.DAY_VOTE, 1_000_000);

    const alive = room.players; // 9 人全存活，顺序即座位 0..8
    const A = alive[8].seat; // 得 4 票
    const B = alive[0].seat; // 得 4 票
    const C = alive[1].seat; // 得 1 票
    for (const i of [0, 1, 2, 3])
      room.submitAction(alive[i].playerId, { targetSeat: A }, 1_000_000);
    for (const i of [4, 5, 6, 7])
      room.submitAction(alive[i].playerId, { targetSeat: B }, 1_000_000);
    room.submitAction(alive[8].playerId, { targetSeat: C }, 1_000_000);

    // 平票(4:4) → 加投一次，本回合无人出局
    expect(room.revote).toBe(1);
    expect(room.players.every((p) => p.alive)).toBe(true);
    expect(room.step).toBe(WerewolfStep.DAY_RESULT);
  });

  it('白天：猎人被票出可开枪带走一人', () => {
    const room = makeRoom();
    room.start();
    advanceTo(room, WerewolfStep.NIGHT_WOLF, 1_000_000);
    const victim = byRole(room, WerewolfRole.VILLAGER);
    for (const w of wolves(room)) {
      if (w.alive)
        room.submitAction(w.playerId, { targetSeat: victim.seat }, 1_000_000);
    }
    advanceTo(room, WerewolfStep.NIGHT_SEER, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.SEER).playerId,
      { targetSeat: wolves(room)[0].seat },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.NIGHT_WITCH, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.WITCH).playerId,
      { useAntidote: true },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.NIGHT_GUARD, 1_000_000);
    room.submitAction(
      byRole(room, WerewolfRole.GUARD).playerId,
      { targetSeat: victim.seat },
      1_000_000,
    );
    advanceTo(room, WerewolfStep.DAY_VOTE, 1_000_000);

    const hunter = byRole(room, WerewolfRole.HUNTER);
    const other = room.players.find(
      (p) => p.alive && p.playerId !== hunter.playerId,
    )!;
    for (const p of room.players.filter((x) => x.alive)) {
      const t = p.playerId === hunter.playerId ? other.seat : hunter.seat;
      room.submitAction(p.playerId, { targetSeat: t }, 1_000_000);
    }
    expect(room.step).toBe(WerewolfStep.HUNTER_SHOOT);
    const wolfSeat = wolves(room)[0].seat;
    room.submitAction(hunter.playerId, { targetSeat: wolfSeat }, 1_000_000);
    expect(room.players[wolfSeat].alive).toBe(false);
  });

  it('整局自动推演必产生胜者且终局公开全部角色', () => {
    const room = makeRoom();
    room.start();
    const now = 1_000_000;
    let guard = 0;
    while (room.step !== WerewolfStep.GAME_OVER && guard++ < 600) {
      const step = room.step;
      const hunter = room.players.find((p) => p.role === WerewolfRole.HUNTER)!;
      if (step === WerewolfStep.NIGHT_WOLF) {
        const good = room.players.find(
          (p) => p.alive && p.role !== WerewolfRole.WEREWOLF,
        );
        const t = good ? good.seat : -1;
        for (const w of wolves(room)) {
          if (w.alive && t >= 0)
            room.submitAction(w.playerId, { targetSeat: t }, now);
        }
      } else if (step === WerewolfStep.NIGHT_SEER) {
        const seer = byRole(room, WerewolfRole.SEER);
        if (seer.alive) {
          const ts = room.getPrivateView(seer.playerId).legalTargets;
          if (ts.length)
            room.submitAction(seer.playerId, { targetSeat: ts[0] }, now);
        }
      } else if (step === WerewolfStep.NIGHT_WITCH) {
        const witch = byRole(room, WerewolfRole.WITCH);
        if (witch.alive) room.submitAction(witch.playerId, {}, now);
      } else if (step === WerewolfStep.NIGHT_GUARD) {
        const guardP = byRole(room, WerewolfRole.GUARD);
        if (guardP.alive) {
          const ts = room.getPrivateView(guardP.playerId).legalTargets;
          if (ts.length)
            room.submitAction(guardP.playerId, { targetSeat: ts[0] }, now);
        }
      } else if (step === WerewolfStep.DAY_VOTE) {
        for (const p of room.players.filter((x) => x.alive)) {
          const ts = room.getPrivateView(p.playerId).legalTargets;
          if (ts.length)
            room.submitAction(p.playerId, { targetSeat: ts[0] }, now);
        }
      } else if (step === WerewolfStep.HUNTER_SHOOT) {
        const ts = room.getPrivateView(hunter.playerId).hunterTargets;
        if (ts.length)
          room.submitAction(hunter.playerId, { targetSeat: ts[0] }, now);
        else room.timeout(now);
      } else {
        room.timeout(now);
      }
    }
    expect(room.step).toBe(WerewolfStep.GAME_OVER);
    expect(room.winner === 'good' || room.winner === 'evil').toBe(true);
    expect(room.getPublicSnapshot().players.every((p) => p.role != null)).toBe(
      true,
    );
  });
});
