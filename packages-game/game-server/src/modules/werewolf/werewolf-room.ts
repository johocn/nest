import {
  Camp,
  MAX_REVOTE,
  NIGHT_ORDER,
  PRESET_SETUPS,
  ROLE_META,
  STEP_DURATION_MS,
  WEREWOLF_MAX_PLAYERS,
  WEREWOLF_MIN_PLAYERS,
  WerewolfRole,
  WerewolfStep,
} from './werewolf.constants';
import {
  ActionPayload,
  CreateRoomOptions,
  PrivatePlayerView,
  PublicPlayerView,
  RoomMessage,
  RoomSnapshot,
  WerewolfErr,
  WerewolfPlayer,
  WerewolfStateView,
} from './werewolf.types';

type Rng = () => number;

/**
 * 狼人杀对局状态机（纯逻辑，零框架依赖）。
 * 服务端 WerewolfService 持有其实例并负责：定时器调度、socket.io 广播、持久化。
 * 本类只负责"给定输入 → 推进状态"，不碰网络/DB，因此可被单测直接驱动。
 *
 * 阶段推进模型：
 *  - 每个回合（cycle）由 buildStepQueue 生成有序阶段队列；
 *  - advance() 在"离开当前步骤"时 finalizeStep（结算该步骤），再进入下一步；
 *  - 夜晚死亡在 NIGHT_END 进入时结算并展示；白天放逐在离开 DAY_VOTE 时结算，于 DAY_RESULT 展示；
 *  - 公告类步骤（NIGHT_BEGIN 等）仅靠定时器推进（isStepComplete 恒 false）；
 *  - 行动类步骤待所有必要玩家行动后由 maybeAdvance 提前推进。
 */
export class WerewolfRoom {
  readonly roomId: string;
  readonly hostPlayerId: string;
  readonly roles: WerewolfRole[];

  players: WerewolfPlayer[] = [];
  step: WerewolfStep = WerewolfStep.LOBBY;
  cycle = 0;
  winner: Camp | null = null;
  phaseEndsAt: number | null = null;
  revote = 0;
  deathsThisStep: number[] = [];

  /** 房间发言记录（含遗言与系统公告），按时间正序 */
  private messages: RoomMessage[] = [];
  private msgSeq = 0;
  /** 本回合刚出局、尚未留下遗言的座位 */
  private pendingLastWords = new Set<number>();

  private stepQueue: WerewolfStep[] = [];
  private stepIndex = -1;

  /** 本夜晚累积行动 */
  private wolfVotes: Record<string, number> = {};
  private nightKillTarget: number | null = null;
  private seerActed = false;
  private seerTarget: number | null = null;
  private witchActed = false;
  private witchAntidote = false;
  private witchAntidoteTarget: number | null = null;
  private witchPoison = false;
  private witchPoisonTarget: number | null = null;
  private guardActed = false;
  private guardTarget: number | null = null;

  /** 白天投票 */
  private dayVotes: Record<string, number> = {};

  /** 猎人开枪 */
  private hunterActed = false;
  private hunterPending = false;

  /** 警长系统 */
  private policeChiefSeat: number | null = null;
  private policeClaims: Record<string, boolean> = {}; // 上警表态：playerId -> 是否上警
  private policeVotes: Record<string, number> = {}; // 选警长投票：playerId -> 候选座位（-1 弃票）
  private policeCandidates: number[] = []; // 本局（竞选当天）上警成功者座位
  private badgeTransferPending = false; // 警长死亡，待其移交警徽

  /**
   * 机器人共享的「已知狼」记忆（仅 botAutoAct 使用，不下发给真人客户端）。
   * 简化建模：预言家机器人查出 evil 后等同于在白天"报点"，其余好人机器人据此投票/开枪。
   * 纯演示 AI 启发式，不影响真实对局规则与真人视角。
   */
  private suspected = new Set<number>();

  /** 狼人夜间频道发言（仅狼人可见，每回合清空） */
  private wolfMessages: RoomMessage[] = [];

  /** 各阶段时长（可被建房选项覆盖，用于"房主自定义时长"） */
  private durations: Record<WerewolfStep, number>;

  private rng: Rng;

  constructor(opts: CreateRoomOptions, rng: Rng = Math.random) {
    this.roomId = opts.roomId;
    this.hostPlayerId = opts.hostPlayerId;
    this.rng = rng;
    const roles = opts.roles ?? this.pickPreset(opts.playerCount);
    this.roles = roles;
    this.durations = { ...STEP_DURATION_MS };
    if (opts.durations) {
      for (const k of Object.keys(opts.durations) as WerewolfStep[]) {
        const v = opts.durations[k];
        if (typeof v === 'number' && v >= 0) this.durations[k] = v;
      }
    }
    this.addPlayer(opts.hostPlayerId, opts.hostName, true);
  }

  // ---------------------------------------------------------------- 建房/进出
  private pickPreset(count?: number): WerewolfRole[] {
    const n = count ?? WEREWOLF_MIN_PLAYERS;
    const keys = Object.keys(PRESET_SETUPS)
      .map(Number)
      .sort((a, b) => a - b);
    let best = keys[0];
    for (const k of keys) if (n >= k) best = k;
    return [...PRESET_SETUPS[best]];
  }

  addPlayer(
    playerId: string,
    name: string,
    isHost = false,
    isBot = false,
  ): void {
    if (this.players.length >= WEREWOLF_MAX_PLAYERS) {
      throw new Error(WerewolfErr.ROOM_FULL);
    }
    if (this.players.find((p) => p.playerId === playerId)) return;
    if (this.step !== WerewolfStep.LOBBY) {
      throw new Error(WerewolfErr.ALREADY_STARTED);
    }
    this.players.push({
      seat: this.players.length,
      playerId,
      name,
      role: null,
      camp: null,
      alive: true,
      isHost,
      isBot,
      witchHasAntidote: true,
      witchHasPoison: true,
      guardLastProtected: null,
      seerKnown: {},
      revealed: false,
    });
  }

  removePlayer(playerId: string): void {
    const idx = this.players.findIndex((p) => p.playerId === playerId);
    if (idx < 0) return;
    this.players.splice(idx, 1);
    this.players.forEach((p, i) => (p.seat = i));
  }

  getPlayer(playerId: string): WerewolfPlayer | undefined {
    return this.players.find((p) => p.playerId === playerId);
  }

  get isRunning(): boolean {
    return (
      this.step !== WerewolfStep.LOBBY && this.step !== WerewolfStep.GAME_OVER
    );
  }

  // -------------------------------------------------------------------- 开局
  start(now: number = Date.now()): void {
    if (this.step !== WerewolfStep.LOBBY) {
      throw new Error(WerewolfErr.ALREADY_STARTED);
    }
    if (this.players.length < WEREWOLF_MIN_PLAYERS) {
      throw new Error(WerewolfErr.ROOM_FULL);
    }
    const setup = [...this.roles];
    if (setup.length > this.players.length) setup.length = this.players.length;
    while (setup.length < this.players.length)
      setup.push(WerewolfRole.VILLAGER);

    this.shuffle(setup);
    this.players.forEach((p, i) => {
      p.role = setup[i];
      p.camp = ROLE_META[setup[i]].camp;
    });

    this.beginCycle(now);
  }

  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  private rolePresent(role: WerewolfRole): boolean {
    return this.players.some((p) => p.role === role);
  }

  private buildStepQueue(): WerewolfStep[] {
    const q: WerewolfStep[] = [WerewolfStep.NIGHT_BEGIN];
    for (const role of NIGHT_ORDER) {
      if (role === WerewolfRole.WEREWOLF) {
        q.push(WerewolfStep.NIGHT_WOLF);
        continue;
      }
      if (this.rolePresent(role)) q.push(this.roleToNightStep(role));
    }
    q.push(WerewolfStep.NIGHT_END);
    q.push(WerewolfStep.DAY_BEGIN);
    // 尚未选出警长才需要竞选；已有警长则直接进入发言
    if (this.policeChiefSeat == null) {
      q.push(WerewolfStep.DAY_NOMINATE);
      q.push(WerewolfStep.DAY_POLICE_VOTE);
    }
    q.push(WerewolfStep.DAY_DISCUSS);
    q.push(WerewolfStep.DAY_VOTE);
    q.push(WerewolfStep.DAY_RESULT);
    return q;
  }

  private roleToNightStep(role: WerewolfRole): WerewolfStep {
    switch (role) {
      case WerewolfRole.SEER:
        return WerewolfStep.NIGHT_SEER;
      case WerewolfRole.WITCH:
        return WerewolfStep.NIGHT_WITCH;
      case WerewolfRole.GUARD:
        return WerewolfStep.NIGHT_GUARD;
      default:
        return WerewolfStep.NIGHT_WOLF;
    }
  }

  private beginCycle(now: number): void {
    this.cycle += 1;
    this.stepQueue = this.buildStepQueue();
    this.stepIndex = -1;
    this.wolfVotes = {};
    this.nightKillTarget = null;
    this.seerActed = false;
    this.seerTarget = null;
    this.witchActed = false;
    this.witchAntidote = false;
    this.witchAntidoteTarget = null;
    this.witchPoison = false;
    this.witchPoisonTarget = null;
    this.guardActed = false;
    this.guardTarget = null;
    this.dayVotes = {};
    this.revote = 0;
    this.pendingLastWords.clear(); // 遗言窗口不跨回合
    this.hunterActed = false;
    this.hunterPending = false;
    this.policeClaims = {};
    this.policeVotes = {};
    this.policeCandidates = [];
    this.badgeTransferPending = false;
    this.wolfMessages = [];
    this.advanceLoop(now);
  }

  // ------------------------------------------------------------- 阶段推进
  private enterStep(step: WerewolfStep, now: number): void {
    this.step = step;
    this.phaseEndsAt =
      this.durations[step] > 0 ? now + this.durations[step] : null;

    switch (step) {
      case WerewolfStep.NIGHT_BEGIN:
        this.deathsThisStep = [];
        break;
      case WerewolfStep.NIGHT_END:
        this.deathsThisStep = [];
        this.resolveNight();
        break;
      case WerewolfStep.DAY_NOMINATE:
        this.deathsThisStep = [];
        break;
      case WerewolfStep.DAY_POLICE_VOTE:
        break;
      case WerewolfStep.DAY_BADGE_TRANSFER:
        this.deathsThisStep = [];
        // 警长已死才需移交，否则瞬间跳过
        this.badgeTransferPending =
          this.policeChiefSeat != null &&
          !this.players.find((p) => p.seat === this.policeChiefSeat)?.alive;
        break;
      case WerewolfStep.DAY_DISCUSS:
        this.deathsThisStep = [];
        break;
      case WerewolfStep.DAY_VOTE:
        this.dayVotes = {};
        break;
      case WerewolfStep.GAME_OVER:
        this.players.forEach((p) => (p.revealed = true));
        break;
      default:
        break;
    }
  }

  /** 离开 step 时的结算（仅处理需要"行动结束即结算"的步骤） */
  private finalizeStep(step: WerewolfStep): void {
    if (step === WerewolfStep.NIGHT_WOLF) {
      this.nightKillTarget = this.majorityVote(Object.values(this.wolfVotes));
    } else if (step === WerewolfStep.DAY_NOMINATE) {
      // 上警成功者 = 存活且表态上警的玩家
      this.policeCandidates = this.players
        .filter((p) => p.alive && this.policeClaims[p.playerId] === true)
        .map((p) => p.seat);
    } else if (step === WerewolfStep.DAY_POLICE_VOTE) {
      this.resolvePoliceVote();
    } else if (step === WerewolfStep.DAY_VOTE) {
      this.resolveDayVote();
    }
  }

  private advance(now: number): void {
    this.finalizeStep(this.step);
    this.stepIndex += 1;
    if (this.stepIndex >= this.stepQueue.length) {
      if (this.winner) {
        this.enterStep(WerewolfStep.GAME_OVER, now);
        return;
      }
      this.beginCycle(now);
      return;
    }
    this.enterStep(this.stepQueue[this.stepIndex], now);
  }

  private advanceLoop(now: number): void {
    this.advance(now);
    let guard = 0;
    while (this.isStepComplete() && guard++ < 32) this.advance(now);
  }

  /** 定时器到点：按"无操作"结算当前步骤，再前进 */
  timeout(now: number = Date.now()): void {
    if (this.step === WerewolfStep.HUNTER_SHOOT && this.hunterPending) {
      this.hunterActed = true;
      this.hunterPending = false;
    }
    if (
      this.step === WerewolfStep.DAY_BADGE_TRANSFER &&
      this.badgeTransferPending
    ) {
      this.policeChiefSeat = null; // 超时未移交 → 撕徽
      this.badgeTransferPending = false;
    }
    this.advanceLoop(now);
  }

  /** 提交行动后，若当前步骤所需行动已齐，则立即前进（避免空等） */
  maybeAdvance(now: number): void {
    let guard = 0;
    while (this.isStepComplete() && guard++ < 32) this.advance(now);
  }

  private isStepComplete(): boolean {
    switch (this.step) {
      case WerewolfStep.NIGHT_WOLF: {
        const wolves = this.players.filter(
          (p) => p.alive && p.role === WerewolfRole.WEREWOLF,
        );
        return wolves.every((w) => this.wolfVotes[w.playerId] !== undefined);
      }
      case WerewolfStep.NIGHT_SEER: {
        const seer = this.players.find((p) => p.role === WerewolfRole.SEER);
        return !seer?.alive ? true : this.seerActed;
      }
      case WerewolfStep.NIGHT_WITCH: {
        const witch = this.players.find((p) => p.role === WerewolfRole.WITCH);
        return !witch?.alive ? true : this.witchActed;
      }
      case WerewolfStep.NIGHT_GUARD: {
        const guard = this.players.find((p) => p.role === WerewolfRole.GUARD);
        return !guard?.alive ? true : this.guardActed;
      }
      case WerewolfStep.DAY_VOTE: {
        const alive = this.players.filter((p) => p.alive);
        return alive.every((p) => this.dayVotes[p.playerId] !== undefined);
      }
      case WerewolfStep.DAY_NOMINATE: {
        const alive = this.players.filter((p) => p.alive);
        return alive.every((p) => this.policeClaims[p.playerId] !== undefined);
      }
      case WerewolfStep.DAY_POLICE_VOTE: {
        const alive = this.players.filter((p) => p.alive);
        return alive.every((p) => this.policeVotes[p.playerId] !== undefined);
      }
      case WerewolfStep.DAY_BADGE_TRANSFER:
        return !this.badgeTransferPending;
      case WerewolfStep.HUNTER_SHOOT:
        return this.hunterActed;
      default:
        return false;
    }
  }

  /**
   * 机器人自动行动：让「当前阶段」一个尚未行动的存活机器人提交合法行动。
   * 返回 true 表示有机器人行动（调用方应继续驱动），false 表示当前阶段已无机器人需要行动。
   * 机器人策略（演示/单人友好，不追求最优）：
   *  - 狼人：跟随已有的狼刀票（真人或其他狼已投则跟随，否则随机选一个非狼存活目标），避免多狼各投导致平票无刀；
   *  - 预言家：随机查验一名存活玩家；
   *  - 女巫：若当晚有人被刀且仍有解药则救人，否则跳过（保守，不主动下毒）；
   *  - 守卫：随机守护一名存活玩家（自然满足"不能连守同一人"）；
   *  - 白天投票：随机投一名非自己的存活玩家；
   *  - 猎人：被票出可开枪时随机带走一名非自己的存活玩家。
   * 复用 submitAction 复用校验与推进逻辑；真人玩家不受影响（isBot=false 时本方法恒返回 false）。
   */
  botAutoAct(now: number = Date.now()): boolean {
    const rand = <T>(arr: T[]): T => arr[Math.floor(this.rng() * arr.length)];

    switch (this.step) {
      case WerewolfStep.NIGHT_WOLF: {
        const aliveWolves = this.players.filter(
          (p) => p.alive && p.role === WerewolfRole.WEREWOLF,
        );
        const unacted = aliveWolves.filter(
          (w) => w.isBot && this.wolfVotes[w.playerId] === undefined,
        );
        if (!unacted.length) return false;
        const existing = Object.values(this.wolfVotes).find(
          (v) => typeof v === 'number',
        );
        const candidates = this.aliveSeats(WerewolfRole.WEREWOLF);
        const target =
          existing != null && candidates.includes(existing)
            ? (existing as number)
            : rand(candidates);
        for (const w of unacted) {
          this.submitAction(w.playerId, { targetSeat: target }, now);
        }
        return true;
      }
      case WerewolfStep.NIGHT_SEER: {
        const seer = this.players.find((p) => p.role === WerewolfRole.SEER);
        if (!seer || !seer.alive || !seer.isBot || this.seerActed) return false;
        const cands = this.aliveSeats();
        const target = rand(cands);
        this.submitAction(seer.playerId, { targetSeat: target }, now);
        // 预言家查出 evil → 记入共享"已知狼"，供白天好人集火
        if (seer.seerKnown[target] === 'evil') this.suspected.add(target);
        return true;
      }
      case WerewolfStep.NIGHT_WITCH: {
        const witch = this.players.find((p) => p.role === WerewolfRole.WITCH);
        if (!witch || !witch.alive || !witch.isBot || this.witchActed) {
          return false;
        }
        // 优先用毒药击杀已知狼（若仍有毒药）；否则用解药救人；都没有则跳过
        if (witch.witchHasPoison) {
          const susp = this.aliveSeats().filter((s) => this.suspected.has(s));
          if (susp.length) {
            this.submitAction(
              witch.playerId,
              { usePoison: true, targetSeat: rand(susp) },
              now,
            );
            return true;
          }
        }
        if (witch.witchHasAntidote && this.nightKillTarget != null) {
          this.submitAction(witch.playerId, { useAntidote: true }, now);
        } else {
          this.submitAction(witch.playerId, {}, now); // 无药可救或无人被刀 → 跳过
        }
        return true;
      }
      case WerewolfStep.NIGHT_GUARD: {
        const guardP = this.players.find((p) => p.role === WerewolfRole.GUARD);
        if (!guardP || !guardP.alive || !guardP.isBot || this.guardActed) {
          return false;
        }
        const cands = this.aliveSeats().filter(
          (s) => s !== guardP.guardLastProtected,
        );
        this.submitAction(guardP.playerId, { targetSeat: rand(cands) }, now);
        return true;
      }
      case WerewolfStep.DAY_VOTE: {
        const unacted = this.players.filter(
          (p) => p.alive && p.isBot && this.dayVotes[p.playerId] === undefined,
        );
        if (!unacted.length) return false;
        for (const p of unacted) {
          const cands = this.aliveSeats().filter((s) => s !== p.seat);
          let vote = rand(cands);
          // 好人（非狼）优先集火已知狼；狼人仍按原策略随机/跟随
          if (p.role !== WerewolfRole.WEREWOLF) {
            const susp = cands.filter((s) => this.suspected.has(s));
            if (susp.length) vote = rand(susp);
          }
          this.submitAction(p.playerId, { targetSeat: vote }, now);
        }
        return true;
      }
      case WerewolfStep.DAY_NOMINATE: {
        const unacted = this.players.filter(
          (p) =>
            p.alive && p.isBot && this.policeClaims[p.playerId] === undefined,
        );
        if (!unacted.length) return false;
        for (const p of unacted) {
          const claim = this.rng() < 0.35; // 约 1/3 概率上警
          this.submitAction(p.playerId, { claimPolice: claim }, now);
        }
        return true;
      }
      case WerewolfStep.DAY_POLICE_VOTE: {
        const unacted = this.players.filter(
          (p) =>
            p.alive && p.isBot && this.policeVotes[p.playerId] === undefined,
        );
        if (!unacted.length) return false;
        for (const p of unacted) {
          const target =
            this.policeCandidates.length && this.rng() < 0.9
              ? rand(this.policeCandidates)
              : -1;
          this.submitAction(p.playerId, { votePolice: target }, now);
        }
        return true;
      }
      case WerewolfStep.DAY_BADGE_TRANSFER: {
        if (!this.badgeTransferPending) return false;
        const chief = this.players.find((p) => p.seat === this.policeChiefSeat);
        if (!chief || chief.alive) return false;
        const cands = this.aliveSeats();
        const target = cands.length ? rand(cands) : -1;
        this.submitAction(chief.playerId, { badgeTarget: target }, now);
        return true;
      }
      case WerewolfStep.HUNTER_SHOOT: {
        if (!this.hunterPending) return false;
        const hunter = this.players.find((p) => p.role === WerewolfRole.HUNTER);
        if (!hunter || !hunter.alive || !hunter.isBot) return false;
        const cands = this.aliveSeats().filter((s) => s !== hunter.seat);
        let target = rand(cands);
        const susp = cands.filter((s) => this.suspected.has(s));
        if (susp.length) target = rand(susp);
        this.submitAction(hunter.playerId, { targetSeat: target }, now);
        return true;
      }
      default:
        return false;
    }
  }

  // ------------------------------------------------------------- 行动提交
  submitAction(
    playerId: string,
    payload: ActionPayload,
    now: number = Date.now(),
  ): WerewolfStateView {
    const player = this.getPlayer(playerId);
    if (!player) throw new Error(WerewolfErr.NOT_IN_ROOM);
    const hunterShooting =
      this.step === WerewolfStep.HUNTER_SHOOT &&
      player.role === WerewolfRole.HUNTER;
    const badgeTransferring =
      this.step === WerewolfStep.DAY_BADGE_TRANSFER &&
      this.badgeTransferPending &&
      player.seat === this.policeChiefSeat;
    if (!player.alive && !hunterShooting && !badgeTransferring) {
      throw new Error(WerewolfErr.DEAD_CANNOT_ACT);
    }

    let err: string | undefined;
    switch (this.step) {
      case WerewolfStep.NIGHT_WOLF:
        err = this.actWolf(player, payload);
        break;
      case WerewolfStep.NIGHT_SEER:
        err = this.actSeer(player, payload);
        break;
      case WerewolfStep.NIGHT_WITCH:
        err = this.actWitch(player, payload);
        break;
      case WerewolfStep.NIGHT_GUARD:
        err = this.actGuard(player, payload);
        break;
      case WerewolfStep.DAY_VOTE:
        err = this.actVote(player, payload);
        break;
      case WerewolfStep.DAY_NOMINATE:
        err = this.actClaimPolice(player, payload);
        break;
      case WerewolfStep.DAY_POLICE_VOTE:
        err = this.actPoliceVote(player, payload);
        break;
      case WerewolfStep.DAY_BADGE_TRANSFER:
        err = this.actBadge(player, payload);
        break;
      case WerewolfStep.HUNTER_SHOOT:
        err = this.actHunter(player, payload);
        break;
      default:
        err = WerewolfErr.NOT_YOUR_TURN;
    }

    if (err) {
      const view = this.getStateView(playerId);
      view.private.lastError = err;
      return view;
    }
    this.maybeAdvance(now);
    return this.getStateView(playerId);
  }

  private aliveSeats(exceptRole?: WerewolfRole): number[] {
    return this.players
      .filter((p) => p.alive && p.role !== exceptRole)
      .map((p) => p.seat);
  }

  private validateTarget(seat: number | undefined, legal: number[]): boolean {
    return (
      typeof seat === 'number' && legal.includes(seat) && this.seatAlive(seat)
    );
  }

  private seatAlive(seat: number): boolean {
    const p = this.players.find((x) => x.seat === seat);
    return !!p && p.alive;
  }

  private actWolf(p: WerewolfPlayer, a: ActionPayload): string | undefined {
    if (p.role !== WerewolfRole.WEREWOLF) return WerewolfErr.NOT_YOUR_TURN;
    const legal = this.aliveSeats(WerewolfRole.WEREWOLF);
    if (!this.validateTarget(a.targetSeat, legal)) {
      return WerewolfErr.INVALID_TARGET;
    }
    this.wolfVotes[p.playerId] = a.targetSeat!;
    return undefined;
  }

  private actSeer(p: WerewolfPlayer, a: ActionPayload): string | undefined {
    if (p.role !== WerewolfRole.SEER) return WerewolfErr.NOT_YOUR_TURN;
    if (this.seerActed) return WerewolfErr.NOT_YOUR_TURN;
    const legal = this.aliveSeats();
    if (!this.validateTarget(a.targetSeat, legal)) {
      return WerewolfErr.INVALID_TARGET;
    }
    const target = this.players.find((x) => x.seat === a.targetSeat);
    if (target) {
      p.seerKnown[target.seat] = target.camp!;
      this.seerTarget = target.seat;
      this.seerActed = true;
    }
    return undefined;
  }

  private actWitch(p: WerewolfPlayer, a: ActionPayload): string | undefined {
    if (p.role !== WerewolfRole.WITCH) return WerewolfErr.NOT_YOUR_TURN;
    if (this.witchActed) return WerewolfErr.NOT_YOUR_TURN;
    const useAnti = !!a.useAntidote;
    const usePoi = !!a.usePoison;
    if (useAnti && !p.witchHasAntidote) return WerewolfErr.WITCH_NO_ANTIDOTE;
    if (usePoi && !p.witchHasPoison) return WerewolfErr.WITCH_NO_POISON;
    if (useAnti && usePoi) return WerewolfErr.WITCH_BOTH; // 同一晚不能同时用两瓶

    if (useAnti) {
      if (this.nightKillTarget == null) return WerewolfErr.INVALID_TARGET;
      this.witchAntidote = true;
      this.witchAntidoteTarget = this.nightKillTarget;
      p.witchHasAntidote = false;
    }
    if (usePoi) {
      const legal = this.aliveSeats();
      if (!this.validateTarget(a.targetSeat, legal)) {
        return WerewolfErr.INVALID_TARGET;
      }
      this.witchPoison = true;
      this.witchPoisonTarget = a.targetSeat!;
      p.witchHasPoison = false;
    }
    this.witchActed = true;
    return undefined;
  }

  private actGuard(p: WerewolfPlayer, a: ActionPayload): string | undefined {
    if (p.role !== WerewolfRole.GUARD) return WerewolfErr.NOT_YOUR_TURN;
    if (this.guardActed) return WerewolfErr.NOT_YOUR_TURN;
    const legal = this.aliveSeats().filter((s) => s !== p.guardLastProtected);
    if (!this.validateTarget(a.targetSeat, legal)) {
      return WerewolfErr.GUARD_SAME_TARGET;
    }
    this.guardTarget = a.targetSeat!;
    p.guardLastProtected = a.targetSeat!;
    this.guardActed = true;
    return undefined;
  }

  private actVote(p: WerewolfPlayer, a: ActionPayload): string | undefined {
    const legal = this.aliveSeats().filter((s) => s !== p.seat);
    if (!this.validateTarget(a.targetSeat, legal)) {
      return WerewolfErr.INVALID_TARGET;
    }
    this.dayVotes[p.playerId] = a.targetSeat!;
    return undefined;
  }

  private actHunter(p: WerewolfPlayer, a: ActionPayload): string | undefined {
    if (!this.hunterPending) return WerewolfErr.NOT_YOUR_TURN;
    const legal = this.aliveSeats().filter((s) => s !== p.seat);
    if (!this.validateTarget(a.targetSeat, legal)) {
      return WerewolfErr.INVALID_TARGET;
    }
    this.kill(a.targetSeat!, 'hunter');
    this.hunterActed = true;
    this.hunterPending = false;
    this.checkWin();
    return undefined;
  }

  private actClaimPolice(
    p: WerewolfPlayer,
    a: ActionPayload,
  ): string | undefined {
    this.policeClaims[p.playerId] = !!a.claimPolice;
    return undefined;
  }

  private actPoliceVote(
    p: WerewolfPlayer,
    a: ActionPayload,
  ): string | undefined {
    const v = typeof a.votePolice === 'number' ? a.votePolice : -1;
    if (v !== -1 && !this.policeCandidates.includes(v)) {
      return WerewolfErr.INVALID_TARGET;
    }
    this.policeVotes[p.playerId] = v;
    return undefined;
  }

  private actBadge(p: WerewolfPlayer, a: ActionPayload): string | undefined {
    if (typeof a.badgeTarget !== 'number') {
      return WerewolfErr.INVALID_TARGET;
    }
    if (a.badgeTarget === -1) {
      this.policeChiefSeat = null; // 撕徽
    } else if (this.seatAlive(a.badgeTarget)) {
      this.policeChiefSeat = a.badgeTarget;
    } else {
      return WerewolfErr.INVALID_TARGET;
    }
    this.badgeTransferPending = false;
    return undefined;
  }

  private resolvePoliceVote(): void {
    if (this.policeCandidates.length === 0) {
      this.policeChiefSeat = null;
      return;
    }
    const tally: Record<number, number> = {};
    for (const voter of this.players.filter((x) => x.alive)) {
      const t = this.policeVotes[voter.playerId];
      if (
        typeof t === 'number' &&
        t >= 0 &&
        this.policeCandidates.includes(t)
      ) {
        tally[t] = (tally[t] ?? 0) + 1;
      }
    }
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally)
      .map(Number)
      .filter((s) => tally[s] === max);
    if (max === 0 || top.length === 0) {
      this.policeChiefSeat = null; // 无人得票 → 本局无警长
      return;
    }
    const chief =
      top.length === 1 ? top[0] : top[Math.floor(this.rng() * top.length)];
    this.policeChiefSeat = chief;
  }

  // ------------------------------------------------------------- 结算
  private kill(seat: number, _cause: 'wolf' | 'poison' | 'vote' | 'hunter') {
    const p = this.players.find((x) => x.seat === seat);
    if (p && p.alive) {
      p.alive = false;
      this.deathsThisStep.push(seat);
      // 出局者可在随后阶段留下一次遗言
      this.pendingLastWords.add(seat);
      this.pushMessage(p.seat, p.name, '出局了', 'system');
    }
  }

  // ------------------------------------------------------------- 发言 / 遗言
  /** 发言记录上限（超出后丢弃最旧的，避免快照无限膨胀） */
  private static readonly MESSAGE_MAX = 60;

  private pushMessage(
    seat: number,
    name: string,
    text: string,
    kind: RoomMessage['kind'],
  ): void {
    this.messages.push({
      seq: ++this.msgSeq,
      seat,
      name,
      text,
      kind,
      channel: 'public',
      at: Date.now(),
    });
    if (this.messages.length > WerewolfRoom.MESSAGE_MAX) {
      this.messages.splice(0, this.messages.length - WerewolfRoom.MESSAGE_MAX);
    }
  }

  /** 存活玩家：仅白天讨论/投票阶段可发言 */
  private canSpeakNow(p: WerewolfPlayer): boolean {
    if (!p.alive) return false;
    return (
      this.step === WerewolfStep.DAY_DISCUSS ||
      this.step === WerewolfStep.DAY_VOTE
    );
  }

  /** 出局玩家：本回合出局且尚未用过，才可在公告/白天阶段留一次遗言 */
  private canLastWordsNow(p: WerewolfPlayer): boolean {
    if (p.alive) return false;
    if (!this.pendingLastWords.has(p.seat)) return false;
    return (
      this.step === WerewolfStep.NIGHT_END ||
      this.step === WerewolfStep.DAY_BEGIN ||
      this.step === WerewolfStep.DAY_DISCUSS ||
      this.step === WerewolfStep.DAY_RESULT
    );
  }

  private canWolfSpeakNow(p: WerewolfPlayer): boolean {
    if (!p.alive || p.role !== WerewolfRole.WEREWOLF) return false;
    return this.step === WerewolfStep.NIGHT_WOLF;
  }

  /**
   * 发言。返回 undefined 表示成功，否则返回错误码。
   * 存活者白天发言；出局者在遗言窗口内可发一条且仅一条遗言。
   */
  say(playerId: string, text: string): string | undefined {
    const p = this.getPlayer(playerId);
    if (!p) return WerewolfErr.NOT_IN_ROOM;
    const body = (text ?? '').trim().slice(0, 140);
    if (!body) return WerewolfErr.EMPTY_MESSAGE;

    let kind: RoomMessage['kind'];
    if (this.canSpeakNow(p)) {
      kind = 'speech';
    } else if (this.canLastWordsNow(p)) {
      kind = 'lastwords';
      this.pendingLastWords.delete(p.seat); // 遗言仅一次
    } else {
      return WerewolfErr.CANNOT_SPEAK;
    }
    this.pushMessage(p.seat, p.name, body, kind);
    return undefined;
  }

  /** 狼人夜间频道发言：仅存活狼人在狼人行动阶段可发，仅对狼人可见 */
  wolfSay(playerId: string, text: string): string | undefined {
    const p = this.getPlayer(playerId);
    if (!p) return WerewolfErr.NOT_IN_ROOM;
    if (!p.alive) return WerewolfErr.DEAD_CANNOT_ACT;
    if (p.role !== WerewolfRole.WEREWOLF) return WerewolfErr.CANNOT_SPEAK;
    if (this.step !== WerewolfStep.NIGHT_WOLF) return WerewolfErr.CANNOT_SPEAK;
    const body = (text ?? '').trim().slice(0, 140);
    if (!body) return WerewolfErr.EMPTY_MESSAGE;
    this.wolfMessages.push({
      seq: ++this.msgSeq,
      seat: p.seat,
      name: p.name,
      text: body,
      kind: 'speech',
      channel: 'wolf',
      at: Date.now(),
    });
    if (this.wolfMessages.length > 30) {
      this.wolfMessages.splice(0, this.wolfMessages.length - 30);
    }
    return undefined;
  }

  private resolveNight(): void {
    const deaths: Array<{ seat: number; cause: 'wolf' | 'poison' }> = [];
    if (this.nightKillTarget != null) {
      const saved =
        this.guardTarget === this.nightKillTarget ||
        (this.witchAntidote &&
          this.witchAntidoteTarget === this.nightKillTarget);
      if (!saved) deaths.push({ seat: this.nightKillTarget, cause: 'wolf' });
    }
    if (this.witchPoison && this.witchPoisonTarget != null) {
      deaths.push({ seat: this.witchPoisonTarget, cause: 'poison' });
    }

    for (const d of deaths) this.kill(d.seat, d.cause);

    const hunter = this.players.find((p) => p.role === WerewolfRole.HUNTER);
    let hunterSpliced = false;
    if (
      hunter &&
      !hunter.alive &&
      this.deathsThisStep.includes(hunter.seat) &&
      !deaths.some((d) => d.seat === hunter.seat && d.cause === 'poison')
    ) {
      this.hunterPending = true;
      this.stepQueue.splice(this.stepIndex + 1, 0, WerewolfStep.HUNTER_SHOOT);
      hunterSpliced = true;
    }

    // 警长死于昨夜 → 紧跟猎人之后插入移交警徽阶段
    if (
      this.policeChiefSeat != null &&
      !this.players.find((p) => p.seat === this.policeChiefSeat)?.alive
    ) {
      this.stepQueue.splice(
        this.stepIndex + (hunterSpliced ? 2 : 1),
        0,
        WerewolfStep.DAY_BADGE_TRANSFER,
      );
    }

    this.checkWin();
  }

  private resolveDayVote(): void {
    const tally = this.tallyVotes();
    const max = Math.max(0, ...Object.values(tally));
    const top = Object.keys(tally)
      .map(Number)
      .filter((s) => tally[s] === max);

    if (max === 0 || top.length > 1) {
      if (top.length > 1 && this.revote < MAX_REVOTE) {
        this.revote += 1;
        // 在 DAY_RESULT 之后再插一次 DAY_VOTE（加投）：当前为 DAY_VOTE(idx=k)，
        // DAY_RESULT 位于 k+1，故插到 k+2，使 advance 先进入 DAY_RESULT 展示再进入加投。
        this.stepQueue.splice(this.stepIndex + 2, 0, WerewolfStep.DAY_VOTE);
        return;
      }
      this.checkWin();
      return;
    }

    const outSeat = top[0];
    this.kill(outSeat, 'vote');

    const hunter = this.players.find((p) => p.role === WerewolfRole.HUNTER);
    let hunterSpliced = false;
    if (hunter && !hunter.alive && this.deathsThisStep.includes(hunter.seat)) {
      this.hunterPending = true;
      this.stepQueue.splice(this.stepIndex + 1, 0, WerewolfStep.HUNTER_SHOOT);
      hunterSpliced = true;
    }

    // 被放逐者是警长 → 在投票结果公布后插入移交警徽阶段
    if (outSeat === this.policeChiefSeat) {
      this.stepQueue.splice(
        this.stepIndex + (hunterSpliced ? 3 : 2),
        0,
        WerewolfStep.DAY_BADGE_TRANSFER,
      );
    }

    this.checkWin();
  }

  private tallyVotes(): Record<number, number> {
    const tally: Record<number, number> = {};
    for (const voter of this.players.filter((p) => p.alive)) {
      const t = this.dayVotes[voter.playerId];
      if (typeof t !== 'number') continue;
      // 警长拥有 1.5 票（归票权）
      const weight = voter.seat === this.policeChiefSeat ? 1.5 : 1;
      tally[t] = (tally[t] ?? 0) + weight;
    }
    return tally;
  }

  private majorityVote(votes: number[]): number | null {
    const count: Record<number, number> = {};
    for (const v of votes)
      if (typeof v === 'number') count[v] = (count[v] ?? 0) + 1;
    let best: number | null = null;
    let bestN = 0;
    let tie = false;
    for (const k of Object.keys(count)) {
      const n = count[Number(k)];
      if (n > bestN) {
        bestN = n;
        best = Number(k);
        tie = false;
      } else if (n === bestN) {
        tie = true;
      }
    }
    return tie ? null : best;
  }

  private checkWin(): void {
    const aliveWolves = this.players.filter(
      (p) => p.alive && p.role === WerewolfRole.WEREWOLF,
    ).length;
    const aliveGood = this.players.filter(
      (p) => p.alive && p.role !== WerewolfRole.WEREWOLF,
    ).length;
    if (aliveWolves === 0) this.winner = 'good';
    else if (aliveWolves >= aliveGood) this.winner = 'evil';
  }

  // ------------------------------------------------------------- 视图
  private publicPlayers(): PublicPlayerView[] {
    return this.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      alive: p.alive,
      isHost: p.isHost,
      police: p.seat === this.policeChiefSeat,
      role: p.revealed || this.step === WerewolfStep.GAME_OVER ? p.role : null,
    }));
  }

  private currentTally(): Record<number, number> {
    if (this.step === WerewolfStep.NIGHT_WOLF) {
      const t: Record<number, number> = {};
      for (const v of Object.values(this.wolfVotes)) t[v] = (t[v] ?? 0) + 1;
      return t;
    }
    if (this.step === WerewolfStep.DAY_VOTE) return this.tallyVotes();
    return {};
  }

  private pendingActions(): number {
    switch (this.step) {
      case WerewolfStep.NIGHT_WOLF: {
        const wolves = this.players.filter(
          (p) => p.alive && p.role === WerewolfRole.WEREWOLF,
        );
        return wolves.filter((w) => this.wolfVotes[w.playerId] === undefined)
          .length;
      }
      case WerewolfStep.NIGHT_SEER:
        return this.seerActed ? 0 : 1;
      case WerewolfStep.NIGHT_WITCH:
        return this.witchActed ? 0 : 1;
      case WerewolfStep.NIGHT_GUARD:
        return this.guardActed ? 0 : 1;
      case WerewolfStep.DAY_VOTE:
        return this.players.filter(
          (p) => p.alive && this.dayVotes[p.playerId] === undefined,
        ).length;
      default:
        return 0;
    }
  }

  getPublicSnapshot(): RoomSnapshot {
    return {
      roomId: this.roomId,
      step: this.step,
      cycle: this.cycle,
      message: this.stepMessage(),
      phaseEndsAt: this.phaseEndsAt,
      winner: this.winner,
      revote: this.revote,
      players: this.publicPlayers(),
      deathsThisStep: [...this.deathsThisStep],
      tally: this.currentTally(),
      pendingActions: this.pendingActions(),
      messages: [...this.messages],
    };
  }

  private stepMessage(): string {
    switch (this.step) {
      case WerewolfStep.LOBBY:
        return '等待玩家加入…';
      case WerewolfStep.NIGHT_BEGIN:
        return '夜幕降临，请闭眼';
      case WerewolfStep.NIGHT_WOLF:
        return '狼人行动：选择今夜的猎物';
      case WerewolfStep.NIGHT_SEER:
        return '预言家行动：查验一名玩家';
      case WerewolfStep.NIGHT_WITCH:
        return '女巫行动：使用药剂或放弃';
      case WerewolfStep.NIGHT_GUARD:
        return '守卫行动：守护一名玩家';
      case WerewolfStep.NIGHT_END:
        return '天亮了，昨夜有人离世';
      case WerewolfStep.DAY_BEGIN:
        return '白天来临，公布昨夜结果';
      case WerewolfStep.DAY_DISCUSS:
        return '自由发言阶段';
      case WerewolfStep.DAY_VOTE:
        return '投票放逐阶段';
      case WerewolfStep.DAY_RESULT:
        return '投票结果揭晓';
      case WerewolfStep.DAY_NOMINATE:
        return '警长竞选：选择是否上警';
      case WerewolfStep.DAY_POLICE_VOTE:
        return '投票选举警长';
      case WerewolfStep.DAY_BADGE_TRANSFER:
        return this.badgeTransferPending ? '警长移交警徽' : '警徽移交';
      case WerewolfStep.HUNTER_SHOOT:
        return '猎人开枪！';
      case WerewolfStep.GAME_OVER:
        return this.winner === 'good' ? '好人阵营胜利' : '狼人阵营胜利';
      default:
        return '';
    }
  }

  getPrivateView(playerId: string): PrivatePlayerView {
    const p = this.getPlayer(playerId)!;
    const isWolf = p.role === WerewolfRole.WEREWOLF;
    const teammates = isWolf
      ? this.players
          .filter((x) => x.role === WerewolfRole.WEREWOLF && x.seat !== p.seat)
          .map((x) => x.seat)
      : [];

    let canAct = false;
    let legalTargets: number[] = [];
    let hunterTargets: number[] = [];
    let witchTonightKill: number | null = null;

    switch (this.step) {
      case WerewolfStep.NIGHT_WOLF:
        if (isWolf) {
          canAct = true;
          legalTargets = this.aliveSeats(WerewolfRole.WEREWOLF);
        }
        break;
      case WerewolfStep.NIGHT_SEER:
        if (p.role === WerewolfRole.SEER && !this.seerActed) {
          canAct = true;
          legalTargets = this.aliveSeats();
        }
        break;
      case WerewolfStep.NIGHT_WITCH:
        if (p.role === WerewolfRole.WITCH && !this.witchActed) {
          canAct = true;
          witchTonightKill = this.nightKillTarget;
          legalTargets = this.aliveSeats();
        }
        break;
      case WerewolfStep.NIGHT_GUARD:
        if (p.role === WerewolfRole.GUARD && !this.guardActed) {
          canAct = true;
          legalTargets = this.aliveSeats().filter(
            (s) => s !== p.guardLastProtected,
          );
        }
        break;
      case WerewolfStep.DAY_VOTE:
        if (p.alive) {
          canAct = true;
          legalTargets = this.aliveSeats().filter((s) => s !== p.seat);
        }
        break;
      case WerewolfStep.DAY_NOMINATE:
        if (p.alive) canAct = true; // 通过 claimPolice 表态上警/不上警
        break;
      case WerewolfStep.DAY_POLICE_VOTE:
        if (p.alive) {
          canAct = true;
          legalTargets = [...this.policeCandidates];
        }
        break;
      case WerewolfStep.DAY_BADGE_TRANSFER:
        if (this.badgeTransferPending && p.seat === this.policeChiefSeat) {
          canAct = true;
          legalTargets = this.aliveSeats();
        }
        break;
      case WerewolfStep.HUNTER_SHOOT:
        if (this.hunterPending && p.role === WerewolfRole.HUNTER) {
          canAct = true;
          hunterTargets = this.aliveSeats().filter((s) => s !== p.seat);
        }
        break;
      default:
        break;
    }

    return {
      seat: p.seat,
      alive: p.alive,
      role: p.role,
      camp: p.camp,
      teammates,
      isPolice: p.seat === this.policeChiefSeat,
      seerKnown: p.seerKnown,
      witchHasAntidote: p.witchHasAntidote,
      witchHasPoison: p.witchHasPoison,
      canAct,
      legalTargets,
      witchTonightKill,
      hunterMayShoot: canAct,
      hunterTargets,
      canSpeak: this.canSpeakNow(p),
      canLastWords: this.canLastWordsNow(p),
      wolfMessages:
        p.role === WerewolfRole.WEREWOLF ? [...this.wolfMessages] : [],
      canWolfSpeak: this.canWolfSpeakNow(p),
    };
  }

  getStateView(playerId: string): WerewolfStateView {
    return {
      public: this.getPublicSnapshot(),
      private: this.getPrivateView(playerId),
    };
  }

  /** 房间内全员广播视图：公共快照 + 各自私有视图 */
  getBroadcastViews(): {
    public: RoomSnapshot;
    privates: Record<string, PrivatePlayerView>;
  } {
    const pub = this.getPublicSnapshot();
    const privates: Record<string, PrivatePlayerView> = {};
    for (const p of this.players)
      privates[p.playerId] = this.getPrivateView(p.playerId);
    return { public: pub, privates };
  }
}
