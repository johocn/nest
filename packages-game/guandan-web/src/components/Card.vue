<script setup lang="ts">
import { computed } from 'vue';
import type { Card } from '../types';
import { rankLabel, suitSymbol, isRed, isWildCard } from '../utils/card';

const props = defineProps<{
  card: Card;
  selected?: boolean;
  wild?: boolean;
  small?: boolean;
  dim?: boolean;
}>();

const emit = defineEmits<{ (e: 'toggle', id: string): void }>();

const red = computed(() => isRed(props.card.suit));
const label = computed(() => rankLabel(props.card.rank));
const symbol = computed(() => suitSymbol(props.card.suit));
const isJoker = computed(() => props.card.suit === 'joker');
const sizeCls = computed(() => (props.small ? 'w-9 h-14 text-[11px]' : 'w-14 h-20 text-sm'));
</script>

<template>
  <button
    type="button"
    :class="[
      'relative rounded-lg border bg-white text-felt-900 shadow-card transition-all duration-200 select-none',
      sizeCls,
      red ? 'border-red-300' : 'border-slate-300',
      selected ? '-translate-y-3 ring-2 ring-gold-400 shadow-glow' : 'hover:-translate-y-1',
      dim ? 'opacity-70' : '',
      'flex flex-col items-center justify-between p-1',
    ]"
    @click="emit('toggle', card.id)"
  >
    <span :class="['font-bold leading-none self-start', red ? 'text-red-600' : 'text-slate-900']">
      {{ label }}
    </span>
    <span :class="['leading-none', isJoker ? 'text-base' : 'text-2xl', red ? 'text-red-600' : 'text-slate-900']">
      {{ isJoker ? '🃏' : symbol }}
    </span>
    <span
      v-if="!isJoker"
      :class="['font-bold leading-none self-end rotate-180', red ? 'text-red-600' : 'text-slate-900']"
    >
      {{ label }}
    </span>
    <span
      v-if="wild"
      class="absolute -top-1 -right-1 rounded-full bg-gold-400 px-1 text-[9px] font-bold text-felt-900 shadow"
      >配</span
    >
  </button>
</template>
