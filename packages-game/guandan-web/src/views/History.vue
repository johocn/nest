<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useGame } from '../store/game';
import type { HistoryItem } from '../types';
import { Trophy, ArrowLeft, Film } from 'lucide-vue-next';

const game = useGame();
const router = useRouter();
const list = ref<HistoryItem[]>([]);
const loading = ref(false);

onMounted(async () => {
  if (!game.token) {
    router.replace('/');
    return;
  }
  loading.value = true;
  list.value = await game.fetchHistory();
  loading.value = false;
});

function fmt(t: string): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-6">
    <div class="mb-4 flex items-center gap-3">
      <button class="btn-ghost" @click="router.push('/')"><ArrowLeft class="h-4 w-4" /> 返回</button>
      <h2 class="flex items-center gap-2 text-xl font-bold gold-text">
        <Trophy class="h-5 w-5" /> 我的战绩
      </h2>
    </div>

    <div v-if="loading" class="text-center text-felt-50/50">加载中…</div>
    <div v-else-if="!list.length" class="glass p-8 text-center text-felt-50/50">
      还没有对局记录，去大厅开一局吧！
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="(it, i) in list"
        :key="i"
        class="glass flex items-center justify-between px-4 py-3"
      >
        <div>
          <div class="text-sm font-semibold text-felt-50">
            房间 {{ it.tableId.slice(0, 16) }}
          </div>
          <div class="text-xs text-felt-50/60">
            {{ fmt(it.createdAt) }} · 座位 {{ it.seat }} · 队伍 {{ it.team === 0 ? '红队' : '蓝队' }}
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-right">
            <div
              class="text-sm font-bold"
              :class="it.isWinner ? 'text-jade-400' : 'text-felt-50/60'"
            >
              {{ it.isWinner ? '胜' : '负' }}
            </div>
            <div class="text-xs text-gold-300">
              {{ it.levelUp > 0 ? `升 ${it.levelUp} 级` : '未升级' }}
            </div>
          </div>
          <button
            class="btn-ghost px-2 py-1.5 text-xs"
            title="回看该对局每一步出牌"
            @click="router.push(`/replay?tableId=${it.tableId}`)"
          >
            <Film class="h-4 w-4" /> 复盘
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
