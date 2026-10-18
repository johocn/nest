<script setup lang="ts">
import { computed } from 'vue';
import type { ClientGameState, ClientPlayerState } from '../types';
import Card from './Card.vue';
import { isWildCard, comboLabel } from '../utils/card';

const props = defineProps<{
  state: ClientGameState;
  players: ClientPlayerState[];
}>();

const lastPlay = computed(() => props.state.lastPlay);
const seatName = computed(() =>
  lastPlay.value ? props.players[lastPlay.value.seat]?.nickname ?? `座位${lastPlay.value.seat}` : '',
);
</script>

<template>
  <div class="flex min-h-[120px] flex-col items-center justify-center gap-2">
    <template v-if="lastPlay">
      <div class="text-xs text-felt-50/70">
        <span class="font-semibold text-gold-300">{{ seatName }}</span> 出了
        <span class="text-gold-300">{{ comboLabel(lastPlay.combo) }}</span>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-1">
        <Card
          v-for="c in lastPlay.combo.cards"
          :key="c.id"
          :card="c"
          :wild="isWildCard(c, state.level, state.rules)"
          small
        />
      </div>
    </template>
    <template v-else>
      <div class="text-sm text-felt-50/40">等待出牌…</div>
    </template>
    <div
      v-if="state.roundOver && state.matchWinner == null"
      class="rounded-full bg-gold-400/15 px-3 py-1 text-xs text-gold-300"
    >
      本轮结束，即将开启下一回合
    </div>
  </div>
</template>
