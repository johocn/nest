import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  AiLevel,
  AuthResult,
  Card,
  Combo,
  FriendItem,
  GameView,
  HistoryItem,
  EmojiEvent,
  InviteNotice,
  RankPayload,
  ReplayRound,
} from '../types';
import { post } from '../api/http';
import { connectGuandan } from '../api/socket';
import { playSound, vibrate, resumeAudio } from '../utils/sound';

const TOKEN_KEY = 'guandan_token';
const PID_KEY = 'guandan_pid';
const AID_KEY = 'guandan_aid';

function emitAck<T>(socket: any, event: string, payload: any): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (res: any) => {
      if (res && res.code === 200) resolve(res.data as T);
      else reject(new Error(res?.msg || '操作失败'));
    });
  });
}

export const useGame = defineStore('game', () => {
  const token = ref<string>(localStorage.getItem(TOKEN_KEY) || '');
  const playerId = ref<string>(localStorage.getItem(PID_KEY) || '');
  const accountId = ref<string>(localStorage.getItem(AID_KEY) || '');

  const view = ref<GameView | null>(null);
  const selected = ref<string[]>([]);
  const socket = ref<any>(null);
  const toast = ref<string>('');
  const replay = ref<ReplayRound[]>([]);
  const friends = ref<FriendItem[]>([]);
  const rankData = ref<RankPayload | null>(null);
  const invite = ref<InviteNotice | null>(null);
  const emojis = ref<EmojiEvent[]>([]);

  const mySeat = computed(() => view.value?.yourSeat ?? -1);
  const myPlayer = computed(() => view.value?.players?.[mySeat.value]);
  const isMyTurn = computed(
    () =>
      view.value?.state.turn === mySeat.value &&
      !view.value?.state.roundOver &&
      view.value?.state.matchWinner == null,
  );

  let toastTimer: any = null;
  function flash(msg: string) {
    toast.value = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ''), 2600);
  }

  function persist() {
    localStorage.setItem(TOKEN_KEY, token.value);
    localStorage.setItem(PID_KEY, playerId.value);
    localStorage.setItem(AID_KEY, accountId.value);
  }

  async function guestLogin(): Promise<void> {
    const r = await post<AuthResult>('/api/client/v1/auth/guest', {});
    token.value = r.token;
    playerId.value = r.playerId;
    accountId.value = r.accountId;
    persist();
    ensureSocket();
  }

  async function login(username: string, password: string): Promise<void> {
    const r = await post<AuthResult>('/api/client/v1/auth/login', {
      username,
      password,
    });
    token.value = r.token;
    playerId.value = r.playerId;
    accountId.value = r.accountId;
    persist();
    ensureSocket(); // 登录后即连上，便于接收好友邀请
  }

  async function register(
    username: string,
    password: string,
    nickname: string,
  ): Promise<void> {
    const r = await post<AuthResult>('/api/client/v1/auth/register', {
      username,
      password,
      nickname,
    });
    token.value = r.token;
    playerId.value = r.playerId;
    accountId.value = r.accountId;
    persist();
    ensureSocket();
  }

  function ensureSocket() {
    if (socket.value?.connected) return socket.value;
    const s = connectGuandan(token.value);
    socket.value = s;
    bindUpdate();
    s.on('connect_error', () => flash('连接失败，请确认后端服务已启动'));
    return s;
  }

  function applyView(v: GameView) {
    const prev = view.value;
    const prevCounts: Record<number, number> = {};
    if (prev?.players)
      for (const p of prev.players) prevCounts[p.seat] = p.handCount ?? 0;
    const prevBombs = prev?.state?.bombCount ?? 0;
    const prevWinner = prev?.state?.matchWinner ?? null;
    view.value = v;
    if (!isMyTurn.value) selected.value = [];

    // 炸弹音效：本回合炸弹数增加时触发
    const newBombs = v.state?.bombCount ?? 0;
    if (newBombs > prevBombs) {
      playSound('bomb');
      vibrate([0, 60, 40, 80]);
    }
    // 胜负音效：整局结束时按本队触发
    const newWinner = v.state?.matchWinner ?? null;
    if (newWinner != null && prevWinner == null) {
      playSound(newWinner === mySeat.value % 2 ? 'win' : 'lose');
      vibrate([0, 120, 60, 120, 60, 220]);
    }
    // 报单提示：手牌从 >1 变为 1 张时弹提示 + 音效/震动
    if (v.players) {
      for (const p of v.players) {
        const before = prevCounts[p.seat] ?? 0;
        if (before > 1 && (p.handCount ?? 0) === 1) {
          flash(`${p.nickname ?? '玩家'} 报单！`);
          playSound('single');
          vibrate(200);
        }
      }
    }
  }

  function bindUpdate() {
    if (!socket.value) return;
    socket.value.off('guandan:update');
    socket.value.on('guandan:update', applyView);
    socket.value.off('guandan:invited');
    socket.value.on('guandan:invited', (n: InviteNotice) => {
      invite.value = n;
      flash(`${n?.fromNickname ?? '好友'} 邀请你加入牌局`);
    });
    socket.value.off('guandan:emoji');
    socket.value.on('guandan:emoji', (e: EmojiEvent) => {
      // 同座位只保留最新一个气泡，2.6s 后自动消失
      emojis.value = [...emojis.value.filter(x => x.seat !== e.seat), e];
      const t = setTimeout(() => {
        emojis.value = emojis.value.filter(x => x.ts !== e.ts);
      }, 2600);
      emojiTimers.push(t);
    });
  }

  let emojiTimers: any[] = [];
  async function sendEmoji(emoji: string): Promise<void> {
    if (!view.value) return;
    try {
      await emitAck<any>(socket.value, 'guandan:emoji', {
        tableId: view.value.roomId,
        emoji,
      });
    } catch (e: any) {
      flash(e.message || '发送失败');
    }
  }

  async function createRoom(
    mode: 'ai' | 'net',
    aiLevel: AiLevel = 'normal',
  ): Promise<void> {
    ensureSocket();
    resumeAudio();
    const data = await emitAck<any>(socket.value, 'guandan:create', {
      mode,
      aiLevel,
    });
    view.value = data.view;
    bindUpdate();
  }

  async function joinRoom(tableId: string): Promise<void> {
    ensureSocket();
    resumeAudio();
    const data = await emitAck<any>(socket.value, 'guandan:join', { tableId });
    view.value = data.view;
    bindUpdate();
  }

  async function startGame(): Promise<void> {
    if (!view.value) return;
    resumeAudio();
    const data = await emitAck<any>(socket.value, 'guandan:start', {
      tableId: view.value.roomId,
    });
    view.value = data;
  }

  function toggleCard(id: string) {
    const i = selected.value.indexOf(id);
    if (i >= 0) selected.value.splice(i, 1);
    else selected.value.push(id);
  }

  function applyHint(combo: Combo) {
    selected.value = combo.cards.map((c: Card) => c.id);
  }

  async function playSelected(): Promise<void> {
    if (!view.value) return;
    if (!selected.value.length) {
      flash('请先选择要出的牌');
      return;
    }
    resumeAudio(); // 用户手势解锁音频
    try {
      const data = await emitAck<any>(socket.value, 'guandan:action', {
        tableId: view.value.roomId,
        action: { type: 'play', cards: [...selected.value] },
      });
      view.value = data;
      selected.value = [];
      playSound('play');
    } catch (e: any) {
      flash(e.message || '出牌无效');
    }
  }

  async function pass(): Promise<void> {
    if (!view.value) return;
    resumeAudio();
    try {
      const data = await emitAck<any>(socket.value, 'guandan:action', {
        tableId: view.value.roomId,
        action: { type: 'pass' },
      });
      view.value = data;
      selected.value = [];
    } catch (e: any) {
      flash(e.message || '操作无效');
    }
  }

  async function leaveRoom(): Promise<void> {
    if (!view.value) return;
    try {
      await emitAck(socket.value, 'guandan:leave', {
        tableId: view.value.roomId,
      });
    } catch {
      /* ignore */
    }
  }

  async function setHost(on: boolean): Promise<void> {
    if (!view.value) return;
    try {
      const data = await emitAck<any>(socket.value, 'guandan:host', {
        tableId: view.value.roomId,
        on,
      });
      view.value = data;
    } catch (e: any) {
      flash(e.message || '操作失败');
    }
  }

  async function fetchHistory(): Promise<HistoryItem[]> {
    ensureSocket();
    try {
      return await emitAck<HistoryItem[]>(socket.value, 'guandan:history', {});
    } catch {
      return [];
    }
  }

  async function loadReplay(tableId: string): Promise<ReplayRound[]> {
    ensureSocket();
    try {
      const data = await emitAck<ReplayRound[]>(
        socket.value,
        'guandan:replay',
        { tableId },
      );
      replay.value = Array.isArray(data) ? data : [];
      return replay.value;
    } catch {
      replay.value = [];
      return [];
    }
  }

  async function loadFriends(): Promise<FriendItem[]> {
    ensureSocket();
    try {
      const data = await emitAck<FriendItem[]>(
        socket.value,
        'guandan:friends',
        {},
      );
      friends.value = Array.isArray(data) ? data : [];
    } catch {
      friends.value = [];
    }
    return friends.value;
  }

  async function inviteFriend(
    friendPlayerId: string,
    tableId: string,
  ): Promise<number> {
    ensureSocket();
    const res = await emitAck<{ delivered: number }>(
      socket.value,
      'guandan:invite',
      {
        friendPlayerId,
        tableId,
      },
    );
    return res?.delivered ?? 0;
  }

  async function loadRank(limit = 20): Promise<RankPayload> {
    ensureSocket();
    try {
      rankData.value = await emitAck<RankPayload>(
        socket.value,
        'guandan:rank',
        { limit },
      );
    } catch {
      rankData.value = null;
    }
    return rankData.value ?? { top: [], me: null, total: 0 };
  }

  function clearInvite() {
    invite.value = null;
  }

  function reset() {
    view.value = null;
    selected.value = [];
    invite.value = null;
    emojis.value = [];
    emojiTimers.forEach(t => clearTimeout(t));
    emojiTimers = [];
  }

  return {
    token,
    playerId,
    accountId,
    view,
    selected,
    toast,
    replay,
    friends,
    rankData,
    invite,
    emojis,
    mySeat,
    myPlayer,
    isMyTurn,
    guestLogin,
    login,
    register,
    createRoom,
    joinRoom,
    startGame,
    toggleCard,
    applyHint,
    playSelected,
    pass,
    leaveRoom,
    setHost,
    fetchHistory,
    loadReplay,
    loadFriends,
    inviteFriend,
    loadRank,
    clearInvite,
    sendEmoji,
    reset,
    flash,
  };
});
