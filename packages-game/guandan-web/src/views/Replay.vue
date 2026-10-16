<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useGame } from '../store/game';
import Card from '../components/Card.vue';
import { comboLabel } from '../utils/card';
import type { Card as CardT, Combo, ReplayAction, ReplayRound } from '../types';
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, RotateCcw } from 'lucide-vue-next';

const game = useGame();
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const rounds = ref<ReplayRound[]>([]);
const roundIdx = ref(0);
const step = ref(0);
const playing = ref(false);
let timer: any = null;

const tableId = String(route.query.tableId ?? '');
const round = computed(() => rounds.value[roundIdx.value] ?? null);
const total = computed(() => round.value?.actions?.length ?? 0);
const players = computed(() => round.value?.players ?? []);

function nameOf(seat: number): string {
  return players.value.find((p) => p.seat === seat)?.nickname ?? `座位${seat}`;
}

/** 从开局手牌快照重放已执行的动作，得到当前各家手牌 */
const hands = computed<CardT[][]>(() => {
  const r = round.value;
  if (!r) return [[], [], [], []];
  const h: CardT[][] = (r.initialHands ?? []).map((x) => [...(x ?? [])]);
  const acts = r.actions ?? [];
  for (let i = 0; i < step.value && i < acts.length; i++) {
    const a = acts[i];
    if (!a) continue;
    if (a.type === 'play' && a.cards?.length) {
      const ids = new Set(a.cards.map((c) => c.id));
      h[a.seat] = h[a.seat].filter((c) => !ids.has(c.id));
    } else if (a.type === 'kitty' && a.cards?.length) {
      h[a.seat] = [...h[a.seat], ...a.cards];
    }
  }
  return h;
});

const lastAction = computed<ReplayAction | null>(() =>
  step.value > 0 ? (round.value?.actions?.[step.value - 1] ?? null) : null,
);

function actionLabel(a: ReplayAction): string {
  if (a.type === 'pass') return '过牌';
  if (a.type === 'kitty') return `领取底牌 ${a.cards?.length ?? 0} 张`;
  const base = comboLabel({ type: a.comboType } as unknown as Combo);
  return a.isBomb ? `${base}（炸弹）` : base;
}

const kowtowText = computed(() => {
  const k = round.value?.kowtow;
  if (!k) return '';
  if (k.anti) return k.reason === 'double-down' ? '双下抗贡，本局免贡' : '末游握王，抗贡免贡';
  return `${nameOf(k.giverSeat)} 进贡 → ${nameOf(k.receiverSeat)}，还贡 → ${nameOf(k.giverSeat)}`;
});

function stop() {
  playing.value = false;
  if (timer) clearInterval(timer);
  timer = null;
}
function toggle() {
  if (playing.value) return stop();
  if (step.value >= total.value) step.value = 0;
  playing.value = true;
  timer = setInterval(() => {
    if (step.value < total.value) step.value++;
    else stop();
  }, 900);
}
function prev() {
  stop();
  if (step.value > 0) step.value--;
}
function next() {
  stop();
  if (step.value < total.value) step.value++;
}
function restart() {
  stop();
  step.value = 0;
}

watch(roundIdx, () => {
  stop();
  step.value = 0;
});

onMounted(async () => {
  if (!game.token || !tableId) {
    router.replace('/history');
    return;
  }
  rounds.value = await game.loadReplay(tableId);
  loading.value = false;
});
onUnmounted(stop);
</script>

<template>
  <div class="mx-auto flex h-full max-w-4xl flex-col overflow-hidden px-3 py-3">
    <div class="mb-2 flex items-center justify-between gap-2">
      <button class="btn-ghost px-2 py-1.5" @click="router.push('/history')">
        <ArrowLeft class="h-4 w-4" /> 返回
      </button>
      <div class="flex items-center gap-2 text-xs">
        <select
          v-if="rounds.length > 1"
          v-model.number="roundIdx"
          class="rounded border border-gold-400/30 bg-felt-800 px-2 py-1 text-felt-50"
        >
          <option v-for="(r, i) in rounds" :key="r.id" :value="i">第 {{ i + 1 }} 局</option>
        </select>
        <span class="rounded-full bg-gold-400/15 px-2 py-0.5 text-gold-300">
          打 {{ round?.level }}
        </span>
      </div>
    </div>

    <div v-if="loading" class="py-10 text-center text-felt-50/50">加载回放…</div>
    <div v-else-if="!rounds.length" class="glass p-8 text-center text-felt-50/60">
      该对局暂无回放数据
    </div>

    <template v-else>
      <!-- 当前动作 -->
      <div class="glass mb-2 px-3 py-2 text-center text-sm">
        <template v-if="!lastAction">
          <span class="text-felt-50/70">开局（第 {{ step }}/{{ total }} 步）</span>
          <div v-if="kowtowText" class="mt-1 text-xs text-gold-300">{{ kowtowText }}</div>
        </template>
        <template v-else>
          <span class="font-semibold text-felt-50">{{ nameOf(lastAction.seat) }}</span>
          <span class="mx-1 text-gold-300">{{ actionLabel(lastAction) }}</span>
          <span class="text-xs text-felt-50/50">第 {{ step }}/{{ total }} 步</span>
          <div v-if="lastAction.cards?.length" class="mt-1.5 flex flex-wrap justify-center gap-1">
            <Card
              v-for="c in lastAction.cards"
              :key="c.id"
              :card="c"
              :small="true"
              :dim="true"
            />
          </div>
        </template>
      </div>

      <!-- 四家手牌（复盘全部可见） -->
      <div class="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
        <div v-for="p in players" :key="p.seat" class="glass p-2">
          <div class="mb-1 flex items-center justify-between text-xs">
            <span class="font-semibold text-felt-50">{{ p.nickname }}</span>
            <span class="text-felt-50/60">剩 {{ hands[p.seat]?.length ?? 0 }} 张</span>
          </div>
          <div class="flex flex-wrap gap-1">
            <Card v-for="c in hands[p.seat] ?? []" :key="c.id" :card="c" :small="true" />
          </div>
        </div>
      </div>

      <!-- 结算 -->
      <div
        v-if="step === total && round?.settlement"
        class="mt-2 rounded-lg border border-gold-400/30 bg-gold-400/10 px-3 py-1.5 text-center text-xs text-gold-200"
      >
        {{ round.settlement.desc }} · 胜方队伍 {{ round.settlement.winningTeam === 0 ? '红队' : '蓝队' }}
      </div>

      <!-- 控制条 -->
      <div class="mt-2 flex items-center gap-2">
        <button class="btn-ghost px-2 py-1.5" @click="restart"><RotateCcw class="h-4 w-4" /></button>
        <button class="btn-ghost px-2 py-1.5" @click="prev"><SkipBack class="h-4 w-4" /></button>
        <button class="btn-gold px-3 py-1.5" @click="toggle">
          <component :is="playing ? Pause : Play" class="h-4 w-4" />
          {{ playing ? '暂停' : '播放' }}
        </button>
        <button class="btn-ghost px-2 py-1.5" @click="next"><SkipForward class="h-4 w-4" /></button>
        <input
          type="range"
          min="0"
          :max="total"
          v-model.number="step"
          class="ml-1 flex-1 accent-gold-400"
        />
      </div>
    </template>
  </div>
</template>
