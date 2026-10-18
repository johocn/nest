<template>
  <div class="flex items-center gap-1 overflow-x-auto py-1">
    <span class="shrink-0 rounded bg-gold-400/15 px-1.5 py-0.5 text-[10px] text-gold-300">记牌</span>
    <div
      v-for="it in items"
      :key="it.rank"
      :class="[
        'flex shrink-0 flex-col items-center rounded px-1 py-0.5 text-[10px] leading-tight',
        it.left === 0 ? 'bg-black/20 opacity-35' : 'bg-black/30',
        it.rank === level ? 'ring-1 ring-gold-400/70' : '',
      ]"
    >
      <span
        :class="[
          it.rank >= 16 ? (it.rank === 17 ? 'text-red-300' : 'text-slate-200') : '',
          it.rank === level ? 'text-gold-300' : 'text-felt-50/80',
        ]"
        >{{ it.label }}</span
      >
      <span :class="it.rank === level ? 'text-gold-300' : 'text-felt-50/60'">{{ it.left }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CardCounterItem } from '../types';

defineProps<{
  items: CardCounterItem[];
  level: number;
}>();
</script>
