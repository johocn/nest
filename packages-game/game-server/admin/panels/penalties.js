/**
 * 面板：封禁处置（处罚记录查询 / 分级处置 / 踢下线）
 * 注册到 window.XGamePanels，由 index.html 按注册表渲染
 */
(function () {
  const { api, toast, confirmDanger, fmtTime } = window.XGameCore;

  const LEVELS = [
    { value: 'warning', label: '警告', danger: false, timed: false },
    { value: 'mute', label: '禁言', danger: false, timed: true },
    { value: 'guild_remove', label: '帮派除名', danger: true, timed: false },
    { value: 'trade_limit', label: '限制交易', danger: false, timed: true },
    { value: 'ban', label: '封禁', danger: true, timed: true },
  ];

  window.XGamePanels = window.XGamePanels || {};
  window.XGamePanels['penalties'] = {
    label: '封禁处置',
    icon: 'ti ti-gavel',
    order: 10,
    component: {
      template: `
        <div>
          <div class="card">
            <div class="card-header">
              <h3>处置记录查询</h3>
              <span class="muted">按玩家 ID 查询历史处置（后端按 playerId 检索）</span>
            </div>
            <div class="card-body">
              <div class="filter-bar">
                <div class="form-group narrow">
                  <label>玩家 ID</label>
                  <input v-model="queryPlayerId" placeholder="如 10001" @keyup.enter="load">
                </div>
                <button class="btn btn-primary" @click="load" :disabled="loading || !queryPlayerId.trim()">
                  {{ loading ? '查询中...' : '查询' }}
                </button>
              </div>
              <div v-if="error" class="alert alert-error" style="margin-top:12px">{{ error }}</div>
              <div class="table-wrap" style="margin-top:12px">
                <table>
                  <thead><tr><th>记录 ID</th><th>等级</th><th>理由</th><th>生效时间</th><th>到期时间</th><th>操作人</th></tr></thead>
                  <tbody>
                    <tr v-if="loading"><td colspan="6" style="text-align:center;padding:24px"><span class="spinner"></span></td></tr>
                    <tr v-else-if="list.length === 0"><td colspan="6" class="empty-state">{{ queried ? '暂无处置记录' : '请输入玩家 ID 后查询' }}</td></tr>
                    <tr v-for="p in list" :key="p.id">
                      <td>{{ p.id }}</td>
                      <td><span class="badge" :class="levelBadge(p.level)">{{ levelLabel(p.level) }}</span></td>
                      <td style="max-width:280px;white-space:normal;word-break:break-all">{{ p.reason }}</td>
                      <td>{{ fmtTime(p.createdAt) }}</td>
                      <td>{{ p.until ? fmtTime(p.until) : '永久/不适用' }}</td>
                      <td>{{ p.createdBy || '-' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><h3>施加处置</h3></div>
            <div class="card-body">
              <div class="detail-grid">
                <div class="form-group">
                  <label>玩家 ID（playerId）</label>
                  <input v-model="form.playerId" placeholder="游戏内玩家 ID">
                </div>
                <div class="form-group">
                  <label>账号 ID（accountId）</label>
                  <input v-model="form.accountId" placeholder="账号 ID（封禁/禁言会写入该账号）">
                </div>
                <div class="form-group">
                  <label>处置等级</label>
                  <select v-model="form.level">
                    <option v-for="l in LEVELS" :key="l.value" :value="l.value">{{ l.label }}（{{ l.value }}）</option>
                  </select>
                </div>
                <div class="form-group" v-if="timedLevel">
                  <label>时长（秒，可空表示永久）</label>
                  <input v-model.number="form.durationSeconds" type="number" min="1" placeholder="如 86400">
                </div>
              </div>
              <div class="form-group">
                <label>理由（必填，1-255 字）</label>
                <textarea v-model="form.reason" placeholder="处置理由，将写入处罚记录与审计"></textarea>
              </div>
              <div class="alert alert-error" v-if="submitError">{{ submitError }}</div>
              <div class="row-actions">
                <button class="btn" :class="isDanger ? 'btn-danger' : 'btn-primary'" @click="submit" :disabled="submitting">
                  {{ submitting ? '提交中...' : '提交处置' }}
                </button>
                <button class="btn btn-secondary" @click="kick" :disabled="kicking">踢下线（按账号 ID）</button>
              </div>
              <div class="muted" style="margin-top:10px">
                提示：warning 仅留痕不产生限制；mute/trade_limit/ban 会按账号 ID 写入限制，账号 ID 填错将不生效。降级处置会被后端拒绝。
              </div>
            </div>
          </div>
        </div>`,
      setup() {
        const { ref, reactive, computed } = Vue;

        const queryPlayerId = ref('');
        const list = ref([]);
        const loading = ref(false);
        const queried = ref(false);
        const error = ref('');

        async function load() {
          const pid = queryPlayerId.value.trim();
          if (!pid) return;
          loading.value = true;
          error.value = '';
          try {
            const data = await api(`/auth/penalties/${encodeURIComponent(pid)}`);
            list.value = Array.isArray(data) ? data : [];
            queried.value = true;
          } catch (e) {
            list.value = [];
            queried.value = true;
            error.value = e.message;
          } finally {
            loading.value = false;
          }
        }

        const form = reactive({ playerId: '', accountId: '', level: 'warning', durationSeconds: null, reason: '' });
        const submitting = ref(false);
        const submitError = ref('');

        const timedLevel = computed(() => LEVELS.find((l) => l.value === form.level)?.timed);
        const isDanger = computed(() => LEVELS.find((l) => l.value === form.level)?.danger);

        async function submit() {
          submitError.value = '';
          const playerId = form.playerId.trim();
          const accountId = form.accountId.trim();
          if (!playerId || !accountId) {
            submitError.value = '玩家 ID 与账号 ID 均为必填';
            return;
          }
          if ((form.durationSeconds ?? '') !== '' && (form.durationSeconds ?? 0) <= 0) {
            submitError.value = '时长必须为正整数（留空表示永久）';
            return;
          }
          const levelLabel = LEVELS.find((l) => l.value === form.level)?.label || form.level;
          const duration = timedLevel.value && form.durationSeconds ? `${form.durationSeconds} 秒` : '永久';
          const reason = await confirmDanger({
            title: `确认施加处置：${levelLabel}`,
            target: `玩家 ${playerId} / 账号 ${accountId}`,
            action: `施加 ${levelLabel}（${form.level}）`,
            impact: isDanger.value
              ? `${duration} 内限制生效，账号状态被直接改写`
              : `${duration} 内限制生效（warning 仅留痕）`,
            danger: isDanger.value,
          });
          if (!reason) return;

          submitting.value = true;
          try {
            const body = { playerId, accountId, level: form.level, reason };
            if (timedLevel.value && form.durationSeconds) body.durationSeconds = Number(form.durationSeconds);
            await api('/auth/penalties', { method: 'POST', body: JSON.stringify(body) });
            toast(`已施加处置：${levelLabel}`, 'success');
            form.reason = '';
            queryPlayerId.value = playerId;
            await load();
          } catch (e) {
            submitError.value = e.message;
          } finally {
            submitting.value = false;
          }
        }

        const kicking = ref(false);
        async function kick() {
          const accountId = form.accountId.trim();
          if (!accountId) {
            submitError.value = '踢下线需要填写账号 ID';
            return;
          }
          const reason = await confirmDanger({
            title: '确认踢下线',
            target: `账号 ${accountId}`,
            action: '使该账号全部端 token 失效',
            impact: '该账号当前所有登录态立即失效，需重新登录',
            danger: true,
          });
          if (!reason) return;
          kicking.value = true;
          submitError.value = '';
          try {
            await api(`/auth/players/${encodeURIComponent(accountId)}/logout`, { method: 'POST' });
            toast('已踢下线', 'success');
          } catch (e) {
            submitError.value = e.message;
          } finally {
            kicking.value = false;
          }
        }

        function levelLabel(v) {
          return LEVELS.find((l) => l.value === v)?.label || v;
        }
        function levelBadge(v) {
          if (v === 'ban' || v === 'guild_remove') return 'badge-red';
          if (v === 'warning') return 'badge-gray';
          return 'badge-yellow';
        }

        return { queryPlayerId, list, loading, queried, error, load, form, submitting, submitError, timedLevel, isDanger, submit, kicking, kick, levelLabel, levelBadge, LEVELS, fmtTime };
      },
    },
  };
})();