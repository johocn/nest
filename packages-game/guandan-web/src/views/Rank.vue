<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useGame } from '../store/game';
import { Crown, ArrowLeft } from 'lucide-vue-next';

const game = useGame();
const router = useRouter();
const loading = ref(true);

onMounted(async () => {
  if (!game.token) {
    router.replace('/');
    return;
  }
  await game.loadRank(20);
  loading.value = false;
});
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-6">
    <div class="mb-4 flex items-center gap-3">
      <button class="btn-ghost" @click="router.push('/')"><ArrowLeft class="h-4 w-4" /> 返回</button>
      <h2 class="flex items-center gap-2 text-xl font-bold gold-text">
        <Crown class="h-5 w-5" /> 段位排行
      </h2>
    </div>

    <div v-if="loading" class="text-center text-felt-50/50">加载中…</div>

    <template v-else>
      <!-- 我的段位 -->
      <div v-if="game.rankData?.me" class="glass mb-4 flex items-center justify-between px-4 py-3">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-lg font-bold text-gold-300">{{ game.rankData.me.title }}</span>
            <span class="rounded bg-gold-400/15 px-1.5 text-xs text-gold-300">
              第 {{ game.rankData.me.rank }} 名
            </span>
          </div>
          <div class="mt-0.5 text-xs text-felt-50/60">
            {{ game.rankData.me.games }} 局 · 胜 {{ game.rankData.me.wins }} · 段位分
            {{ game.rankData.me.score }}
          </div>
        </div>
        <div class="text-right text-xs text-felt-50/60">
          <div>累计升级 {{ game.rankData.me.levelUp }}</div>
          <div>
            胜率
            {{
              game.rankData.me.games
                ? Math.round((game.rankData.me.wins / game.rankData.me.games) * 100)
                : 0
            }}%
          </div>
        </div>
      </div>
      <div v-else class="glass mb-4 px-4 py-3 text-center text-xs text-felt-50/50">
        你还没有对局记录，先去打一局吧！
      </div>

      <!-- 榜单 -->
      <div class="space-y-2">
        <div
          v-for="r in game.rankData?.top ?? []"
          :key="r.playerId"
          :class="[
            'glass flex items-center justify-between px-4 py-2.5',
            r.playerId === game.playerId ? 'ring-1 ring-gold-400/40' : '',
          ]"
        >
          <div class="flex items-center gap-3">
            <span
              :class="[
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                r.rank === 1
                  ? 'bg-gold-400 text-felt-900'
                  : r.rank === 2
                    ? 'bg-slate-300 text-felt-900'
                    : r.rank === 3
                      ? 'bg-amber-700 text-felt-50'
                      : 'bg-black/30 text-felt-50/70',
              ]"
              >{{ r.rank }}</span
            >
            <div>
              <div class="text-sm font-semibold text-felt-50">{{ r.nickname }}</div>
              <div class="text-xs text-felt-50/60">{{ r.title }} · {{ r.games }} 局</div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-sm font-bold text-gold-300">{{ r.score }} 分</div>
            <div class="text-xs text-felt-50/60">胜 {{ r.wins }}</div>
          </div>
        </div>
      </div>

      <div v-if="!game.rankData?.top?.length" class="glass p-8 text-center text-felt-50/50">
        排行榜暂无数据
      </div>
    </template>
  </div>
</template>
