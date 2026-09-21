/**
 * 面板：举报处置（举报台账 / 处置动作 / 社交后果补执行）
 * 注册到 window.XGamePanels，由 index.html 按注册表渲染
 */
(function () {
  const { api, toast, confirmDanger, fmtTime } = window.XGameCore;

  const ACTIONS = [
    { value: 'IGNORE', label: '忽略举报', danger: false },
    { value: 'WARN', label: '警告被举报人', danger: false },
    { value: 'MUTE', label: '禁言被举报人', danger: false },
    { value: 'BAN', label: '封禁被举报人', danger: true },
  ];
  const REASON_LABEL = { abuse: '辱骂', ad: '广告', fraud: '欺诈', cheat: '作弊', other: '其他' };
  const TARGET_LABEL = { player: '玩家', chat_message: '聊天消息', guild: '帮派' };
  const STATUS_LABEL = { pending: '待处理', processed: '已处理', ignored: '已忽略' };

  window.XGamePanels = window.XGamePanels || {};
  window.XGamePanels['reports'] = {
    label: '举报处置',
    icon: 'ti ti-flag',
    order: 20,
    component: {
      template: `
        <div>
          <div class="card">
            <div class="card-header">
              <h3>举报台账</h3>
              <div class="filter-bar">
                <div class="form-group narrow">
                  <label>状态</label>
                  <select v-model="status" @change="load(1)">
                    <option value="">全部</option>
                    <option value="pending">待处理</option>
                    <option value="processed">已处理</option>
                    <option value="ignored">已忽略</option>
                  </select>
                </div>
                <button class="btn btn-secondary" @click="load(page)" :disabled="loading">刷新</button>
              </div>
            </div>
            <div class="card-body">
              <div v-if="error" class="alert alert-error">{{ error }}</div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>ID</th><th>举报人</th><th>被举报对象</th><th>类型</th><th>举报内容</th><th>状态</th><th>提交时间</th><th>处置</th></tr></thead>
                  <tbody>
                    <tr v-if="loading"><td colspan="8" style="text-align:center;padding:24px"><span class="spinner"></span></td></tr>
                    <tr v-else-if="list.length === 0"><td colspan="8" class="empty-state">暂无举报数据</td></tr>
                    <template v-for="r in list" :key="r.id">
                      <tr>
                        <td>{{ r.id }}</td>
                        <td>{{ r.reporterId }}</td>
                        <td>{{ targetLabel(r.targetType) }} #{{ r.targetId }}</td>
                        <td><span class="badge badge-blue">{{ reasonLabel(r.reason) }}</span></td>
                        <td style="max-width:260px;white-space:normal;word-break:break-all">{{ r.content || '-' }}</td>
                        <td><span class="badge" :class="statusBadge(r.status)">{{ statusLabel(r.status) }}</span></td>
                        <td>{{ fmtTime(r.createdAt) }}</td>
                        <td>
                          <button v-if="r.status === 'pending'" class="btn btn-primary btn-sm" @click="openHandle(r)">处置</button>
                          <span v-else class="muted">{{ r.handleAction || '-' }} / {{ r.handleRemark || '无备注' }}</span>
                        </td>
                      </tr>
                      <tr v-if="activeId === r.id">
                        <td colspan="8" style="background:#f8fafc">
                          <div class="filter-bar">
                            <div class="form-group narrow">
                              <label>处置动作</label>
                              <select v-model="act.action">
                                <option v-for="a in ACTIONS" :key="a.value" :value="a.value" :disabled="a.value !== 'IGNORE' && r.targetType !== 'player'">
                                  {{ a.label }}（{{ a.value }}）
                                </option>
                              </select>
                            </div>
                            <div class="form-group narrow" v-if="needDuration">
                              <label>时长（秒，可空）</label>
                              <input v-model.number="act.durationSeconds" type="number" min="1" placeholder="如 86400">
                            </div>
                            <div class="form-group" style="flex:1;min-width:240px">
                              <label>处置备注（将作为处置理由留痕）</label>
                              <input v-model="act.remark" placeholder="如：经查属实，禁言 1 天">
                            </div>
                            <button class="btn" :class="actIsDanger ? 'btn-danger' : 'btn-primary'" @click="applyHandle(r)" :disabled="handling">
                              {{ handling ? '提交中...' : '确认处置' }}
                            </button>
                            <button class="btn btn-secondary" @click="activeId = null" :disabled="handling">取消</button>
                          </div>
                          <div class="muted" style="margin-top:8px" v-if="r.targetType !== 'player'">
                            该举报目标不是玩家，仅可执行「忽略举报」；需要惩罚请先定位到玩家类举报。
                          </div>
                          <div class="alert alert-error" style="margin-top:8px" v-if="handleError">{{ handleError }}</div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
              <div class="pagination">
                <button :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
                <span>第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 条</span>
                <button :disabled="page >= totalPages || loading" @click="load(page + 1)">下一页</button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h3>社交后果补执行</h3>
              <span class="muted">对历史封禁账号补跑社交后果（好友/帮派关系清理）</span>
            </div>
            <div class="card-body">
              <div class="filter-bar">
                <div class="form-group narrow">
                  <label>玩家 ID</label>
                  <input v-model="cleanupPlayerId" placeholder="如 10001">
                </div>
                <button class="btn btn-secondary" @click="socialCleanup" :disabled="cleaning || !cleanupPlayerId.trim()">
                  {{ cleaning ? '执行中...' : '执行补执行' }}
                </button>
              </div>
              <div class="alert alert-error" style="margin-top:12px" v-if="cleanupError">{{ cleanupError }}</div>
            </div>
          </div>
        </div>`,
      setup() {
        const { ref, reactive, computed, onMounted } = Vue;
        const LIMIT = 20;

        const status = ref('');
        const list = ref([]);
        const page = ref(1);
        const total = ref(0);
        const loading = ref(false);
        const error = ref('');

        const totalPages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)));

        async function load(p) {
          const target = Math.max(1, p || 1);
          loading.value = true;
          error.value = '';
          try {
            const qs = new URLSearchParams({ page: String(target), limit: String(LIMIT) });
            if (status.value) qs.set('status', status.value);
            const data = await api(`/community/reports?${qs.toString()}`);
            list.value = data?.items || [];
            total.value = data?.total ?? list.value.length;
            page.value = target;
            activeId.value = null;
          } catch (e) {
            list.value = [];
            total.value = 0;
            error.value = e.message;
          } finally {
            loading.value = false;
          }
        }

        const activeId = ref(null);
        const act = reactive({ action: 'IGNORE', remark: '', durationSeconds: null });
        const handling = ref(false);
        const handleError = ref('');

        const needDuration = computed(() => act.action === 'MUTE' || act.action === 'BAN');
        const actIsDanger = computed(() => ACTIONS.find((a) => a.value === act.action)?.danger);

        function openHandle(r) {
          activeId.value = r.id;
          act.action = 'IGNORE';
          act.remark = '';
          act.durationSeconds = null;
          handleError.value = '';
        }

        async function applyHandle(r) {
          handleError.value = '';
          const actionLabel = ACTIONS.find((a) => a.value === act.action)?.label || act.action;
          if ((act.durationSeconds ?? '') !== '' && (act.durationSeconds ?? 0) <= 0) {
            handleError.value = '时长必须为正整数（留空表示永久）';
            return;
          }
          const duration = needDuration.value && act.durationSeconds ? `${act.durationSeconds} 秒` : '永久';
          const reason = await confirmDanger({
            title: `确认处置举报 #${r.id}：${actionLabel}`,
            target: `举报 #${r.id}｜${targetLabel(r.targetType)} #${r.targetId}（举报人 ${r.reporterId}）`,
            action: `${actionLabel}（${act.action}）`,
            impact:
              act.action === 'IGNORE'
                ? '举报标记为已忽略，不产生任何惩罚'
                : `对目标玩家施加惩罚并留痕（时长：${duration}）`,
            danger: !!actIsDanger.value,
          });
          if (!reason) return;

          handling.value = true;
          try {
            const body = { action: act.action, remark: reason };
            if (needDuration.value && act.durationSeconds) body.durationSeconds = Number(act.durationSeconds);
            await api(`/community/reports/${encodeURIComponent(r.id)}/handle`, {
              method: 'POST',
              body: JSON.stringify(body),
            });
            toast(`举报 #${r.id} 已处置：${actionLabel}`, 'success');
            await load(page.value);
          } catch (e) {
            handleError.value = e.message;
          } finally {
            handling.value = false;
          }
        }

        const cleanupPlayerId = ref('');
        const cleaning = ref(false);
        const cleanupError = ref('');

        async function socialCleanup() {
          const pid = cleanupPlayerId.value.trim();
          if (!pid) return;
          cleanupError.value = '';
          const reason = await confirmDanger({
            title: '确认补执行社交后果',
            target: `玩家 ${pid}`,
            action: '补执行历史封禁的社交后果',
            impact: '清理该玩家的社交关系（好友/帮派等），动作不可撤销',
            danger: true,
          });
          if (!reason) return;
          cleaning.value = true;
          try {
            await api(`/community/players/${encodeURIComponent(pid)}/social-cleanup`, { method: 'POST' });
            toast(`已对玩家 ${pid} 补执行社交后果`, 'success');
          } catch (e) {
            cleanupError.value = e.message;
          } finally {
            cleaning.value = false;
          }
        }

        function reasonLabel(v) {
          return REASON_LABEL[v] || v;
        }
        function targetLabel(v) {
          return TARGET_LABEL[v] || v;
        }
        function statusLabel(v) {
          return STATUS_LABEL[v] || v;
        }
        function statusBadge(v) {
          if (v === 'pending') return 'badge-yellow';
          if (v === 'processed') return 'badge-green';
          return 'badge-gray';
        }

        onMounted(() => load(1));

        return {
          status, list, page, total, totalPages, loading, error, load,
          activeId, act, handling, handleError, needDuration, actIsDanger, openHandle, applyHandle,
          cleanupPlayerId, cleaning, cleanupError, socialCleanup,
          reasonLabel, targetLabel, statusLabel, statusBadge, ACTIONS, fmtTime,
        };
      },
    },
  };
})();