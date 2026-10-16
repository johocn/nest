<script setup lang="ts">
import { computed } from 'vue';
import type { ClientPlayerState } from '../types';
import { User, Crown, Users, Hand } from 'lucide-vue-next';

const props = defineProps<{
  player: ClientPlayerState;
  level: number;
  isSelf?: boolean;
  isPartner?: boolean;
  compact?: boolean;
  /** 当前要弹出的表情气泡 */
  bubble?: string;
}>();

const statusText = computed(() => {
  if (props.player.isOut) return props.player.finishOrder ? `第 ${props.player.finishOrder} 名` : '已出局';
  if (props.player.passed) return '过牌';
  return `剩 ${props.player.handCount} 张`;
});

const report = computed(() => {
  if (props.player.isOut) return null;
  const n = props.player.handCount ?? 0;
  if (n === 1) return { text: '报单', single: true };
  if (n <= 10) return { text: `报${n}`, single: false };
  return null;
});
</script>

<template>
  <div
    :class="[
      'glass relative flex items-center transition-all duration-300',
      compact ? 'gap-1.5 px-2 py-1' : 'gap-2 px-3 py-2',
      player.isCurrentTurn ? 'ring-2 ring-gold-400 shadow-glow animate-pulseGold' : '',
    ]"
  >
    <transition name="bubble">
      <span
        v-if="bubble"
        class="pointer-events-none absolute -top-3 right-1 z-20 rounded-full border border-gold-400/30 bg-felt-800/95 px-1.5 py-0.5 text-base shadow-glow"
        >{{ bubble }}</span
      >
    </transition>
    <div
      :class="[
        'flex shrink-0 items-center justify-center rounded-full bg-gold-400/15 text-gold-300',
        compact ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm',
      ]"
    >
      <span :class="compact ? 'text-xs font-bold' : 'text-sm font-bold'">{{ player.nickname?.slice(0, 1) || '?' }}</span>
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1">
        <span :class="['truncate font-semibold text-felt-50', compact ? 'text-xs' : 'text-sm']">{{ player.nickname }}</span>
        <span
          v-if="isSelf"
          class="rounded bg-jade-400/20 px-1 text-[10px] text-jade-400">我</span
        >
        <span
          v-if="isPartner"
          class="rounded bg-gold-400/20 px-1 text-[10px] text-gold-300">搭档</span
        >
        <span
          v-if="player.hosted"
          class="rounded bg-slate-500/30 px-1 text-[10px] text-slate-200">托管</span
        >
        <span
          v-else-if="!player.isBot && player.connected === false"
          class="rounded bg-red-500/20 px-1 text-[10px] text-red-300">断线</span
        >
      </div>
      <div class="flex items-center gap-1 text-xs text-felt-50/70">
        <template v-if="player.isOut"><Crown class="h-3 w-3 text-gold-300" /></template>
        <template v-else-if="player.isBot"><User class="h-3 w-3" /></template>
        <template v-else><Users class="h-3 w-3" /></template>
        <span>{{ statusText }}</span>
        <span
          v-if="report"
          :class="[
            'rounded px-1 text-[10px] font-semibold',
            report.single ? 'animate-pulse bg-red-500/25 text-red-300' : 'bg-gold-400/20 text-gold-300',
          ]"
          >{{ report.text }}</span
        >
        <Hand v-if="player.passed && !player.isOut" class="h-3 w-3 text-slate-400" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.bubble-enter-active {
  animation: bubbleUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.bubble-leave-active {
  transition: opacity 0.4s ease;
}
.bubble-leave-to {
  opacity: 0;
}
@keyframes bubbleUp {
  0% {
    transform: translateY(8px) scale(0.5);
    opacity: 0;
  }
  60% {
    transform: translateY(-3px) scale(1.2);
    opacity: 1;
  }
  100% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}
</style>
