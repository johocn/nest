<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { computed } from 'vue';
import { useGame } from './store/game';
import { Home, Trophy, LogOut, Crown, UserPlus } from 'lucide-vue-next';

const game = useGame();
const route = useRoute();
const router = useRouter();
const path = computed(() => route.path);

async function acceptInvite() {
  const t = game.invite?.tableId;
  if (!t) return;
  game.clearInvite();
  try {
    await game.joinRoom(t);
    router.push('/table');
  } catch (e: any) {
    game.flash(e.message || '加入房间失败');
  }
}
</script>

<template>
  <div class="relative flex h-full flex-col">
    <header
      :class="[
        'fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-gold-400/20 bg-felt-900/70 px-4 backdrop-blur-xl',
        path === '/table' ? 'hidden sm:flex' : 'flex',
      ]"
    >
      <div class="flex items-center gap-2">
        <span class="text-xl">🃏</span>
        <span class="text-lg font-bold gold-text">掼蛋 · 国潮牌桌</span>
      </div>
      <nav class="flex items-center gap-1 text-sm">
        <router-link
          to="/"
          :class="['btn-ghost', path === '/' ? 'bg-gold-400/15' : '']"
          ><Home class="h-4 w-4" /> 大厅</router-link
        >
        <router-link
          to="/history"
          :class="['btn-ghost', path === '/history' ? 'bg-gold-400/15' : '']"
          ><Trophy class="h-4 w-4" /> 战绩</router-link
        >
        <router-link
          to="/rank"
          :class="['btn-ghost', path === '/rank' ? 'bg-gold-400/15' : '']"
          ><Crown class="h-4 w-4" /> 排行</router-link
        >
        <span v-if="game.playerId" class="ml-2 flex items-center gap-1 text-xs text-felt-50/50">
          <LogOut class="h-3.5 w-3.5" /> {{ game.playerId.slice(0, 6) }}
        </span>
      </nav>
    </header>

    <main :class="['flex-1 overflow-auto', path === '/table' ? 'pt-0' : 'pt-14']">
      <router-view />
    </main>

    <!-- 好友邀请横幅 -->
    <div
      v-if="game.invite"
      class="fixed left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-jade-400/40 bg-felt-800/95 px-4 py-2 text-sm shadow-glow backdrop-blur"
    >
      <UserPlus class="h-4 w-4 text-jade-400" />
      <span class="text-felt-50"
        >{{ game.invite.fromNickname }} 邀请你加入
        <span class="text-gold-300">{{ game.invite.tableId.slice(0, 14) }}</span></span
      >
      <button class="btn-gold px-2 py-1 text-xs" @click="acceptInvite">加入</button>
      <button class="btn-ghost px-2 py-1 text-xs" @click="game.clearInvite()">忽略</button>
    </div>

    <transition name="fade">
      <div
        v-if="game.toast"
        class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-gold-400/30 bg-felt-800/90 px-4 py-2 text-sm text-gold-300 shadow-glow backdrop-blur"
      >
        {{ game.toast }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
