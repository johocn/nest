<script setup lang="ts">
import { ref } from 'vue';
import { useGame } from '../store/game';
import { Play, SkipForward, Lightbulb, RotateCcw, Swords } from 'lucide-vue-next';
import { comboLabel } from '../utils/card';
import type { Combo, GameView } from '../types';

const props = defineProps<{ view: GameView }>();
const game = useGame();
const hintIndex = ref(0);

function hint() {
  const hints = (props.view.actionHint || []) as Combo[];
  if (!hints.length) {
    game.flash('没有可出的牌，只能过牌');
    return;
  }
  const c = hints[hintIndex.value % hints.length];
  game.applyHint(c);
  hintIndex.value++;
}

function resetSel() {
  game.selected.splice(0, game.selected.length);
}
</script>

<template>
  <div class="glass px-4 py-3">
    <div class="mb-2 flex flex-wrap items-center gap-1.5">
      <span class="text-xs text-felt-50/60">可出牌型：</span>
      <button
        v-for="(c, i) in (view.actionHint as Combo[])"
        :key="i"
        type="button"
        class="rounded-full border border-gold-400/25 px-2 py-0.5 text-[11px] text-gold-300 hover:bg-gold-400/10"
        @click="game.applyHint(c)"
      >
        {{ comboLabel(c) }} ({{ c.length }})
      </button>
      <span v-if="!(view.actionHint as Combo[]).length" class="text-[11px] text-felt-50/40">无</span>
    </div>

    <div class="flex items-center gap-2">
      <button class="btn-gold" :disabled="!game.isMyTurn" @click="game.playSelected()">
        <Play class="h-4 w-4" /> 出牌
      </button>
      <button
        class="btn-ghost"
        :disabled="!game.isMyTurn || !view.state.lastPlay"
        @click="game.pass()"
      >
        <SkipForward class="h-4 w-4" /> 过牌
      </button>
      <button class="btn-ghost" :disabled="!game.isMyTurn" @click="hint">
        <Lightbulb class="h-4 w-4" /> 提示
      </button>
      <button class="btn-ghost" @click="resetSel">
        <RotateCcw class="h-4 w-4" /> 重选
      </button>
      <div class="ml-auto flex items-center gap-1 text-xs text-felt-50/60">
        <Swords class="h-3.5 w-3.5 text-gold-300" />
        已选 {{ game.selected.length }} 张
      </div>
    </div>
  </div>
</template>
