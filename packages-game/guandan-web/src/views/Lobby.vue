<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useGame } from '../store/game';
import { LogIn, UserPlus, Play, DoorOpen, Gamepad2, Sparkles, Bot, Trophy, Crown } from 'lucide-vue-next';

const game = useGame();
const router = useRouter();

const tab = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const nickname = ref('');
const busy = ref(false);

const mode = ref<'ai' | 'net'>('ai');
const joinId = ref('');
const joining = ref(false);

const aiLevel = ref<'easy' | 'normal' | 'hard'>('normal');
const levels: { key: 'easy' | 'normal' | 'hard'; label: string; desc: string }[] = [
  { key: 'easy', label: '新手', desc: '只出小牌、偶尔失误，几乎不用炸弹' },
  { key: 'normal', label: '标准', desc: '会甩连牌、残局用炸，默认档' },
  { key: 'hard', label: '高手', desc: '不压搭档、残局果断用炸、会盯对手牌数' },
];

async function doLogin() {
  busy.value = true;
  try {
    if (tab.value === 'login') await game.login(username.value, password.value);
    else await game.register(username.value, password.value, nickname.value);
  } catch (e: any) {
    game.flash(e.message || '登录失败');
  } finally {
    busy.value = false;
  }
}

async function guest() {
  busy.value = true;
  try {
    await game.guestLogin();
  } catch (e: any) {
    game.flash(e.message || '游客登录失败');
  } finally {
    busy.value = false;
  }
}

async function create() {
  busy.value = true;
  try {
    await game.createRoom(mode.value, aiLevel.value);
    router.push('/table');
  } catch (e: any) {
    game.flash(e.message || '建房失败');
  } finally {
    busy.value = false;
  }
}

async function join() {
  if (!joinId.value.trim()) return;
  joining.value = true;
  try {
    await game.joinRoom(joinId.value.trim());
    router.push('/table');
  } catch (e: any) {
    game.flash(e.message || '进房失败');
  } finally {
    joining.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 py-10">
    <!-- 标题 -->
    <div class="text-center">
      <div class="text-5xl animate-floaty">🃏</div>
      <h1 class="mt-2 text-3xl font-bold gold-text">掼蛋 · 国潮牌桌</h1>
      <p class="mt-1 text-sm text-felt-50/60">两副扑克 · 四人两两组队 · 红桃逢人配 · 2 打到 A</p>
    </div>

    <template v-if="!game.token">
      <div class="glass w-full max-w-sm p-5">
        <div class="mb-4 flex gap-2">
          <button
            :class="['btn flex-1', tab === 'login' ? 'btn-gold' : 'btn-ghost']"
            @click="tab = 'login'"
          >
            <LogIn class="h-4 w-4" /> 登录
          </button>
          <button
            :class="['btn flex-1', tab === 'register' ? 'btn-gold' : 'btn-ghost']"
            @click="tab = 'register'"
          >
            <UserPlus class="h-4 w-4" /> 注册
          </button>
        </div>

        <div class="space-y-3">
          <input v-model="username" class="input" placeholder="用户名" />
          <input v-model="password" type="password" class="input" placeholder="密码" />
          <input v-if="tab === 'register'" v-model="nickname" class="input" placeholder="昵称" />
          <button class="btn-gold w-full" :disabled="busy" @click="doLogin">
            {{ tab === 'login' ? '登录' : '注册并登录' }}
          </button>
          <button class="btn-ghost w-full" :disabled="busy" @click="guest">
            <Sparkles class="h-4 w-4" /> 游客一键登录（免注册试玩）
          </button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="grid w-full max-w-2xl gap-4 md:grid-cols-2">
        <div class="glass p-5">
          <div class="mb-3 flex items-center gap-2 text-gold-300">
            <Gamepad2 class="h-5 w-5" /> <span class="font-semibold">创建房间</span>
          </div>
          <div class="mb-3 flex gap-2">
            <button
              :class="['btn flex-1', mode === 'ai' ? 'btn-gold' : 'btn-ghost']"
              @click="mode = 'ai'"
            >
              <Bot class="h-4 w-4" /> AI 补位
            </button>
            <button
              :class="['btn flex-1', mode === 'net' ? 'btn-gold' : 'btn-ghost']"
              @click="mode = 'net'"
            >
              <DoorOpen class="h-4 w-4" /> 联机对战
            </button>
          </div>
          <p class="mb-2 text-xs text-felt-50/60">
            {{ mode === 'ai' ? 'AI 自动补满 3 个电脑玩家，建房即开局。' : '建房后分享房间号，好友加入、满员后房主开局（空位自动补 AI）。' }}
          </p>
          <div class="mb-2">
            <div class="mb-1 flex items-center gap-1.5 text-xs text-gold-300">
              <Bot class="h-3.5 w-3.5" /> AI 强度
            </div>
            <div class="flex gap-1.5">
              <button
                v-for="lv in levels"
                :key="lv.key"
                :class="['btn flex-1 text-xs', aiLevel === lv.key ? 'btn-gold' : 'btn-ghost']"
                @click="aiLevel = lv.key"
              >
                {{ lv.label }}
              </button>
            </div>
            <p class="mt-1 text-[11px] text-felt-50/50">
              {{ levels.find((l) => l.key === aiLevel)?.desc }}
            </p>
          </div>
          <button class="btn-gold w-full" :disabled="busy" @click="create">
            <Play class="h-4 w-4" /> 创建房间
          </button>
        </div>

        <div class="glass p-5">
          <div class="mb-3 flex items-center gap-2 text-gold-300">
            <DoorOpen class="h-5 w-5" /> <span class="font-semibold">加入房间</span>
          </div>
          <input v-model="joinId" class="input mb-3" placeholder="输入房间号（guandan-...）" />
          <button class="btn-ghost w-full" :disabled="joining" @click="join">
            <DoorOpen class="h-4 w-4" /> 加入
          </button>
          <div class="mt-3 flex gap-2">
            <router-link to="/history" class="btn-ghost flex-1">
              <Trophy class="h-4 w-4" /> 我的战绩
            </router-link>
            <router-link to="/rank" class="btn-ghost flex-1">
              <Crown class="h-4 w-4" /> 段位排行
            </router-link>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
