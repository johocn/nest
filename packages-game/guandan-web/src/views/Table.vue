<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useGame } from '../store/game';
import SeatPanel from '../components/SeatPanel.vue';
import PlayArea from '../components/PlayArea.vue';
import Card from '../components/Card.vue';
import ComboBar from '../components/ComboBar.vue';
import CardCounter from '../components/CardCounter.vue';
import { isWildCard, rankLabel, suitSymbol } from '../utils/card';
import { isMuted, setMuted } from '../utils/sound';
import { ArrowLeft, Play, Volume2, VolumeX, UserPlus, Copy } from 'lucide-vue-next';
import type { Card as CardT } from '../types';

const game = useGame();
const router = useRouter();
const now = ref(Date.now());
let tickTimer: any = null;
onMounted(() => {
  if (!game.view) router.replace('/');
  tickTimer = setInterval(() => (now.value = Date.now()), 500);
});
onUnmounted(() => clearInterval(tickTimer));

const remaining = computed(() => {
  const d = state.value?.turnDeadline;
  return d ? Math.max(0, Math.ceil((d - now.value) / 1000)) : 0;
});
const myHosted = computed(() => players.value[mySeat.value]?.hosted === true);

const view = computed(() => game.view);
const state = computed(() => game.view?.state);
const mySeat = computed(() => game.mySeat);
const muted = isMuted();
const aiLevelLabel = computed(
  () =>
    ({ easy: '新手', normal: '标准', hard: '高手' })[view.value?.aiLevel ?? 'normal'] ?? '标准',
);
const players = computed(() => game.view?.players ?? []);
const level = computed(() => state.value?.level ?? 15);
const rules = computed(() => state.value?.rules ?? {});
const myTeam = computed(() => mySeat.value % 2);

// 贡还（进贡/还贡/抗贡）横幅
const kowtow = computed(() => state.value?.kowtow ?? null);
function nameOf(seat?: number): string {
  if (seat == null) return '';
  return players.value[seat]?.nickname ?? `座位${seat}`;
}
function cardDesc(c?: CardT): string {
  if (!c) return '';
  if (c.suit === 'joker') return c.joker === 'big' ? '大王' : '小王';
  return suitSymbol(c.suit) + rankLabel(c.rank);
}
const kowtowText = computed(() => {
  const k = kowtow.value;
  if (!k) return '';
  if (k.anti)
    return k.reason === 'double-down' ? '双下抗贡，本局免贡' : '末游握王，抗贡免贡';
  return `${nameOf(k.giverSeat)} 进贡 ${cardDesc(k.given)} → ${nameOf(k.receiverSeat)}；${
    nameOf(k.receiverSeat)
  } 还 ${cardDesc(k.returned)} → ${nameOf(k.giverSeat)}`;
});

const positioned = computed(() =>
  players.value.map((p) => {
    const off = (p.seat - mySeat.value + 4) % 4;
    const pos = off === 0 ? 'self' : off === 1 ? 'right' : off === 2 ? 'top' : 'left';
    return { p, pos };
  }),
);
function seatAt(pos: string): any {
  return positioned.value.find((x) => x.pos === pos)?.p;
}

// 表情互动
const emojiList = ['👍', '🎉', '😂', '🔥', '👏', '😅', '🤝', '💪'];
function bubbleOf(seat: number): string {
  return game.emojis.find((e) => e.seat === seat)?.emoji ?? '';
}

const myHand = computed(() => players.value[mySeat.value]?.hand ?? []);
const waiting = computed(() => view.value?.mode === 'net' && players.value.some((p) => !p.playerId));
const isHost = computed(() => mySeat.value === 0 && view.value?.mode === 'net');
const finished = computed(() => state.value?.matchWinner != null);
const won = computed(() => finished.value && state.value!.matchWinner === myTeam.value);

// 手牌排序与收拢
const sortMode = ref<'default' | 'suit' | 'rank'>('default');
const collapsed = ref(true);
const suitOrder: Record<string, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3, joker: 4 };
const sortLabel = computed(() => (sortMode.value === 'suit' ? '花色' : sortMode.value === 'rank' ? '点数' : '默认'));
function cycleSort() {
  sortMode.value = sortMode.value === 'default' ? 'suit' : sortMode.value === 'suit' ? 'rank' : 'default';
}
const displayHand = computed<CardT[]>(() => {
  const h = myHand.value;
  if (sortMode.value === 'default' || !h.length) return h;
  const arr = [...h];
  if (sortMode.value === 'suit') {
    arr.sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit] || b.rank - a.rank);
  } else {
    arr.sort((a, b) => b.rank - a.rank);
  }
  return arr;
});

// 好友邀请（仅联机房主在等待时可发起）
const showInvite = ref(false);
const invitingId = ref('');
async function openInvite() {
  showInvite.value = !showInvite.value;
  if (showInvite.value) await game.loadFriends();
}
async function invite(fid: string) {
  if (!view.value) return;
  invitingId.value = fid;
  try {
    const delivered = await game.inviteFriend(fid, view.value.roomId);
    game.flash(delivered > 0 ? '邀请已发送' : '好友当前不在线，可复制房间号分享');
  } catch (e: any) {
    game.flash(e.message || '邀请失败');
  } finally {
    invitingId.value = '';
  }
}
async function copyRoom() {
  if (!view.value) return;
  try {
    await navigator.clipboard.writeText(view.value.roomId);
    game.flash('房间号已复制，发给好友即可加入');
  } catch {
    game.flash(view.value.roomId);
  }
}

async function back() {
  await game.leaveRoom();
  game.reset();
  router.push('/');
}
async function start() {
  try {
    await game.startGame();
  } catch (e: any) {
    game.flash(e.message || '开局失败');
  }
}
</script>

<template>
  <div v-if="view" class="flex h-full flex-col overflow-hidden">
    <!-- 顶栏 -->
    <header class="safe-top flex items-center justify-between gap-2 border-b border-gold-400/20 bg-felt-900/50 px-3 py-2 backdrop-blur">
      <button class="btn-ghost px-2 py-1.5" @click="back"><ArrowLeft class="h-4 w-4" /> 返回</button>
      <div class="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-xs">
        <span class="truncate rounded-full bg-black/30 px-2 py-0.5 text-felt-50/70">房间 {{ view.roomId.slice(0, 10) }}</span>
        <span class="rounded-full bg-gold-400/15 px-2 py-0.5 text-gold-300">级 {{ state?.levelLabel }}</span>
        <span v-if="view?.aiLevel" class="rounded-full bg-black/30 px-2 py-0.5 text-felt-50/70">AI {{ aiLevelLabel }}</span>
        <span v-if="waiting" class="rounded-full bg-jade-400/15 px-2 py-0.5 text-jade-400">等待</span>
        <span v-else class="rounded-full bg-black/30 px-2 py-0.5 text-felt-50/70">出:{{ state?.turn }}</span>
        <span
          v-if="state?.turnDeadline"
          :class="['rounded-full px-2 py-0.5', remaining <= 5 ? 'bg-red-500/25 text-red-300' : 'bg-gold-400/15 text-gold-300']"
          >⏱ {{ remaining }}s</span
        >
      </div>
      <button v-if="isHost && waiting" class="btn-gold px-3 py-1.5" @click="start"><Play class="h-4 w-4" /> 开局</button>
      <button v-if="isHost && waiting" class="btn-ghost px-2 py-1.5" title="邀请好友" @click="openInvite">
        <UserPlus class="h-4 w-4" />
      </button>
      <button
        class="btn-ghost px-2 py-1.5"
        :title="muted ? '开启音效' : '关闭音效'"
        @click="setMuted(!muted)"
      >
        <component :is="muted ? VolumeX : Volume2" class="h-4 w-4" />
      </button>
    </header>

    <!-- 邀请好友面板 -->
    <div v-if="showInvite" class="glass mx-2 mt-2 p-2">
      <div class="mb-1.5 flex items-center justify-between text-xs">
        <span class="font-semibold text-gold-300">邀请好友</span>
        <button class="btn-ghost px-2 py-0.5 text-xs" @click="copyRoom">
          <Copy class="h-3 w-3" /> 复制房间号
        </button>
      </div>
      <div v-if="!game.friends.length" class="py-2 text-center text-xs text-felt-50/50">
        暂无好友，可复制房间号分享给好友
      </div>
      <div v-else class="flex max-h-32 flex-col gap-1 overflow-y-auto">
        <div
          v-for="f in game.friends"
          :key="f.playerId"
          class="flex items-center justify-between rounded px-2 py-1 text-xs"
        >
          <span class="flex items-center gap-1.5 text-felt-50">
            <span :class="['h-1.5 w-1.5 rounded-full', f.online ? 'bg-jade-400' : 'bg-slate-500']" />
            {{ f.nickname }}
          </span>
          <button
            class="btn-ghost px-2 py-0.5 text-[11px]"
            :disabled="invitingId === f.playerId || !f.online"
            @click="invite(f.playerId)"
          >
            {{ f.online ? '邀请' : '离线' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 贡还横幅：进贡/还贡/抗贡 -->
    <div
      v-if="kowtow"
      :class="[
        'mx-2 mt-2 rounded-lg border px-3 py-1.5 text-center text-xs',
        kowtow.anti
          ? 'border-jade-400/40 bg-jade-400/10 text-jade-300'
          : 'border-gold-400/40 bg-gold-400/10 text-gold-200',
      ]"
    >
      <span class="font-semibold">{{ kowtowText }}</span>
    </div>

    <!-- 对手区：三家紧凑排成顶部一行 -->
    <div class="flex items-stretch justify-between gap-1 px-2 pt-2">
      <div class="min-w-0 flex-1">
        <SeatPanel v-if="seatAt('left')" :player="seatAt('left')" :level="level" compact :is-partner="seatAt('left').partnerSeat === mySeat" :bubble="bubbleOf(seatAt('left').seat)" />
      </div>
      <div class="min-w-0 flex-1">
        <SeatPanel v-if="seatAt('top')" :player="seatAt('top')" :level="level" compact :is-partner="seatAt('top').partnerSeat === mySeat" :bubble="bubbleOf(seatAt('top').seat)" />
      </div>
      <div class="min-w-0 flex-1">
        <SeatPanel v-if="seatAt('right')" :player="seatAt('right')" :level="level" compact :is-partner="seatAt('right').partnerSeat === mySeat" :bubble="bubbleOf(seatAt('right').seat)" />
      </div>
    </div>

    <!-- 出牌区（中央） -->
    <div class="relative flex flex-1 items-center justify-center px-2">
      <div class="glass w-full max-w-md p-3">
        <PlayArea :state="state!" :players="players" />
        <div v-if="waiting" class="mt-2 text-center text-[11px] text-felt-50/60">
          联机模式：等待其他玩家加入，满员后由房主点击「开局」。空位将自动补 AI。
        </div>
      </div>
    </div>

    <!-- 记牌器：各点数/王剩余张数（级牌高亮） -->
    <div class="border-t border-gold-400/10 bg-felt-900/30">
      <CardCounter :items="state?.counter ?? []" :level="state?.level ?? 15" />
    </div>

    <!-- 本人区 -->
    <footer class="safe-bottom flex flex-col gap-2 border-t border-gold-400/20 bg-felt-900/40 px-2 pb-2 pt-2 backdrop-blur">
      <div class="flex items-center gap-2">
        <SeatPanel v-if="seatAt('self')" :player="seatAt('self')" :level="level" :is-self="true" :bubble="bubbleOf(mySeat)" />
        <span
          v-if="game.isMyTurn"
          class="animate-pulseGold rounded-full bg-gold-400/20 px-2 py-0.5 text-[11px] font-semibold text-gold-300"
          >轮到你出牌</span
        >
        <div class="ml-auto flex items-center gap-1.5">
          <button
            class="btn-ghost px-2.5 py-1.5 text-xs"
            :class="myHosted ? 'bg-jade-400/20 text-jade-300' : ''"
            @click="game.setHost(!myHosted)"
            >{{ myHosted ? '取消托管' : '托管' }}</button
          >
          <button class="btn-ghost px-2.5 py-1.5 text-xs" @click="cycleSort">排序:{{ sortLabel }}</button>
          <button class="btn-ghost px-2.5 py-1.5 text-xs" @click="collapsed = !collapsed">{{ collapsed ? '展开' : '收拢' }}</button>
        </div>
      </div>

      <ComboBar :view="view" />

      <!-- 快捷表情 -->
      <div class="flex items-center gap-1 overflow-x-auto">
        <span class="shrink-0 text-[11px] text-felt-50/50">表情</span>
        <button
          v-for="e in emojiList"
          :key="e"
          class="shrink-0 rounded-lg border border-gold-400/20 bg-black/20 px-1.5 py-0.5 text-sm transition hover:-translate-y-0.5 hover:border-gold-400/50"
          @click="game.sendEmoji(e)"
        >
          {{ e }}
        </button>
      </div>

      <div class="hand-track" :class="collapsed ? 'is-collapsed' : 'is-expanded overflow-x-auto'">
        <div
          v-for="(c, i) in displayHand"
          :key="c.id"
          :style="collapsed && i > 0 ? { marginLeft: '-1.75rem' } : {}"
          :class="['shrink-0', game.selected.includes(c.id) ? 'relative z-10' : '']"
        >
          <Card
            :card="c"
            :wild="isWildCard(c, level, rules)"
            :small="collapsed"
            :selected="game.selected.includes(c.id)"
            @toggle="game.toggleCard"
          />
        </div>
      </div>
    </footer>

    <!-- 结算遮罩 -->
    <transition name="fade">
      <div v-if="finished" class="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur">
        <div class="glass w-80 p-6 text-center">
          <div class="text-5xl">{{ won ? '🏆' : '💤' }}</div>
          <h2 class="mt-2 text-2xl font-bold" :class="won ? 'gold-text' : 'text-felt-50/80'">
            {{ won ? '胜利' : '惜败' }}
          </h2>
          <p class="mt-1 text-sm text-felt-50/70">{{ state?.settlement?.desc }}</p>
          <button class="btn-gold mt-4 w-full" @click="back">返回大厅</button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.hand-track {
  display: flex;
  align-items: flex-end;
  padding-top: 1rem;
  padding-bottom: 0.25rem;
  scrollbar-width: thin;
}
.hand-track.is-expanded {
  gap: 0.375rem;
}
.hand-track.is-collapsed {
  overflow: visible;
}
</style>
