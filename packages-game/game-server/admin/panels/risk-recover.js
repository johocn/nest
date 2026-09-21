/**
 * 面板：风控回收（线索处置 / 确认回收 / 回收回滚 / 封禁联动）
 * 注册到 window.XGamePanels，由 index.html 按注册表渲染
 */
(function () {
  const { api, toast, confirmDanger, fmtTime, jsonText } = window.XGameCore;

  const CASE_TYPE_LABEL = { round_trip: '环形对倒', one_way: '单向大额', price_divergence: '价格偏离' };
  const CASE_STATUS_LABEL = { open: '待处置', frozen: '已冻结', ignored: '已忽略' };
  const LOCK_LEVELS = [
    { value: 'trade_limit', label: '限制交易', danger: false },
    { value: 'ban', label: '封禁', danger: true },
  ];

  window.XGamePanels = window.XGamePanels || {};
  window.XGamePanels['risk-recover'] = {
    label: '风控回收',
    icon: 'ti ti-shield-exclamation',
    order: 30,
    component: {
      template: `
        <div>
          <div class="card">
            <div class="card-header">
              <h3>风控线索</h3>
              <div class="filter-bar">
                <div class="form-group narrow">
                  <label>状态</label>
                  <select v-model="status" @change="load">
                    <option value="">全部</option>
                    <option value="open">待处置</option>
                    <option value="frozen">已冻结</option>
                    <option value="ignored">已忽略</option>
                  </select>
                </div>
                <div class="form-group narrow">
                  <label>类型</label>
                  <select v-model="caseType" @change="load">
                    <option value="">全部</option>
                    <option value="round_trip">环形对倒</option>
                    <option value="one_way">单向大额</option>
                    <option value="price_divergence">价格偏离</option>
                  </select>
                </div>
                <button class="btn btn-secondary" @click="load" :disabled="loading">刷新</button>
              </div>
            </div>
            <div class="card-body">
              <div v-if="error" class="alert alert-error">{{ error }}</div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>线索 ID</th><th>类型</th><th>风险分</th><th>状态</th><th>涉及玩家</th><th>摘要</th><th>创建时间</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-if="loading"><td colspan="8" style="text-align:center;padding:24px"><span class="spinner"></span></td></tr>
                    <tr v-else-if="list.length === 0"><td colspan="8" class="empty-state">暂无线索（后端最多返回 50 条，无分页）</td></tr>
                    <template v-for="c in list" :key="c.id">
                      <tr>
                        <td>{{ c.id }}</td>
                        <td>{{ typeLabel(c.caseType) }}</td>
                        <td>{{ c.riskScore }}</td>
                        <td><span class="badge" :class="statusBadge(c.status)">{{ statusLabel(c.status) }}</span></td>
                        <td>{{ c.fromId }} → {{ c.toId }}</td>
                        <td style="max-width:260px;white-space:normal;word-break:break-all">{{ summary(c) }}</td>
                        <td>{{ fmtTime(c.createdAt) }}</td>
                        <td>
                          <div class="row-actions">
                            <button class="btn btn-secondary btn-sm" @click="propose(c)" :disabled="proposingId === c.id">
                              {{ proposingId === c.id ? '计算中...' : '回收建议' }}
                            </button>
                            <button class="btn btn-secondary btn-sm" @click="toggle(c.id, 'dispose')">处置</button>
                            <button class="btn btn-secondary btn-sm" @click="doRecover(c)" :disabled="recoveringId === c.id">
                              {{ recoveringId === c.id ? '回收中...' : '确认回收' }}
                            </button>
                            <button class="btn btn-danger btn-sm" @click="doRollback(c)" v-if="recovered[c.id]">
                              回滚回收
                            </button>
                            <button class="btn btn-secondary btn-sm" @click="toggle(c.id, 'lock')">封禁联动</button>
                          </div>
                        </td>
                      </tr>
                      <tr v-if="activeId === c.id && mode === 'dispose'">
                        <td colspan="8" style="background:#f8fafc">
                          <div class="row-actions">
                            <button class="btn btn-primary" @click="dispose(c, 'frozen')" :disabled="busy">
                              {{ busy ? '提交中...' : '冻结线索' }}
                            </button>
                            <button class="btn btn-secondary" @click="dispose(c, 'ignored')" :disabled="busy">忽略线索</button>
                            <button class="btn btn-secondary" @click="close()" :disabled="busy">取消</button>
                          </div>
                          <div class="muted" style="margin-top:8px">点击后弹出确认框，理由必填并写入线索备注。</div>
                        </td>
                      </tr>
                      <tr v-if="activeId === c.id && mode === 'lock'">
                        <td colspan="8" style="background:#fef2f2">
                          <div class="filter-bar">
                            <div class="form-group narrow">
                              <label>联动等级</label>
                              <select v-model="lockLevel">
                                <option v-for="l in LOCK_LEVELS" :key="l.value" :value="l.value">{{ l.label }}（{{ l.value }}）</option>
                              </select>
                            </div>
                            <button class="btn btn-danger" @click="doLock(c)" :disabled="busy">
                              {{ busy ? '提交中...' : '执行封禁联动' }}
                            </button>
                            <button class="btn btn-secondary" @click="close()" :disabled="busy">取消</button>
                          </div>
                          <div class="muted" style="margin-top:8px">点击后弹出确认框，理由必填并写入惩罚记录。</div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
              <div v-if="resultMsg" class="alert" style="background:#f1f5f9;margin-top:12px">{{ resultMsg }}</div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h3>手工回滚回收</h3>
              <span class="muted">本页「确认回收」后可直接回滚；跨会话回滚需填入回收记录 ID</span>
            </div>
            <div class="card-body">
              <div class="filter-bar">
                <div class="form-group narrow">
                  <label>回收记录 ID</label>
                  <input v-model="manualRid" placeholder="risk_recover_records.id">
                </div>
                <button class="btn btn-danger" @click="manualRollback" :disabled="rollingBack || !manualRid.trim()">
                  {{ rollingBack ? '回滚中...' : '确认回滚' }}
                </button>
              </div>
              <div class="alert alert-error" style="margin-top:12px" v-if="rollbackError">{{ rollbackError }}</div>
              <div class="muted" style="margin-top:10px">回滚会把回收额原路退回给原净收款方（toId），并记录回滚理由。</div>
            </div>
          </div>
        </div>`,
      setup() {
        const { ref, onMounted } = Vue;

        const status = ref('');
        const caseType = ref('');
        const list = ref([]);
        const loading = ref(false);
        const error = ref('');
        const resultMsg = ref('');
        const recovered = ref({});

        async function load() {
          loading.value = true;
          error.value = '';
          try {
            const qs = new URLSearchParams();
            if (status.value) qs.set('status', status.value);
            if (caseType.value) qs.set('type', caseType.value);
            const data = await api(`/risk/cases${qs.toString() ? '?' + qs.toString() : ''}`);
            list.value = data?.list || [];
            close();
          } catch (e) {
            list.value = [];
            error.value = e.message;
          } finally {
            loading.value = false;
          }
        }

        const activeId = ref(null);
        const mode = ref('');
        const lockLevel = ref('trade_limit');
        const busy = ref(false);

        function toggle(id, m) {
          resultMsg.value = '';
          if (activeId.value === id && mode.value === m) {
            close();
          } else {
            activeId.value = id;
            mode.value = m;
          }
        }
        function close() {
          activeId.value = null;
          mode.value = '';
        }

        const proposingId = ref(null);
        async function propose(c) {
          proposingId.value = c.id;
          resultMsg.value = '';
          try {
            const data = await api(`/risk/cases/${encodeURIComponent(c.id)}/recover-proposal`, { method: 'POST' });
            resultMsg.value = `线索 #${c.id} 建议回收额：${data?.suggestedAmount ?? '-'} 金币（只读计算，未落库）`;
          } catch (e) {
            resultMsg.value = `线索 #${c.id} 回收建议失败：${e.message}`;
          } finally {
            proposingId.value = null;
          }
        }

        async function dispose(c, action) {
          const label = action === 'frozen' ? '冻结线索' : '忽略线索';
          const reason = await confirmDanger({
            title: `确认${label} #${c.id}`,
            target: `线索 #${c.id}｜${typeLabel(c.caseType)}｜${c.fromId} → ${c.toId}`,
            action: label,
            impact: action === 'frozen' ? '线索置为已冻结（保留回收关联）' : '线索置为已忽略，不再进入待处置队列',
            danger: false,
          });
          if (!reason) return;
          busy.value = true;
          try {
            await api(`/risk/cases/${encodeURIComponent(c.id)}/dispose`, {
              method: 'POST',
              body: JSON.stringify({ action, note: reason }),
            });
            toast(`线索 #${c.id} 已${action === 'frozen' ? '冻结' : '忽略'}`, 'success');
            close();
            await load();
          } catch (e) {
            error.value = e.message;
          } finally {
            busy.value = false;
          }
        }

        const recoveringId = ref(null);
        async function doRecover(c) {
          const reason = await confirmDanger({
            title: `确认回收线索 #${c.id}`,
            target: `线索 #${c.id}｜净收款方 ${c.toId}`,
            action: '真实扣除涉案净差额（金币）',
            impact: '从净收款方账号扣除净差额金币并置线索为冻结，属于真实动账',
            danger: true,
          });
          if (!reason) return;
          recoveringId.value = c.id;
          resultMsg.value = '';
          try {
            const data = await api(`/risk/cases/${encodeURIComponent(c.id)}/recover`, {
              method: 'POST',
              body: JSON.stringify({ note: reason }),
            });
            const rec = data?.record;
            if (rec && rec.id) recovered.value[c.id] = { rid: rec.id, amount: rec.appliedAmount || rec.suggestedAmount, toId: rec.toId };
            resultMsg.value = `线索 #${c.id} 已回收：记录 #${rec?.id ?? '-'}，回收额 ${rec?.appliedAmount ?? '-'} 金币`;
            toast(`线索 #${c.id} 回收完成`, 'success');
            await load();
          } catch (e) {
            error.value = e.message;
          } finally {
            recoveringId.value = null;
          }
        }

        const rollingBack = ref(false);
        const rollbackError = ref('');

        async function doRollback(c) {
          const rec = recovered.value[c.id];
          if (!rec) return;
          const reason = await confirmDanger({
            title: '确认回滚回收',
            target: `回收记录 #${rec.rid}｜线索 #${c.id}｜原净收款方 ${rec.toId}`,
            action: `退回回收额 ${rec.amount ?? '-'} 金币`,
            impact: '把已回收金币原路退回给该账号，属于真实动账且不可撤销',
            danger: true,
          });
          if (!reason) return;
          rollingBack.value = true;
          rollbackError.value = '';
          try {
            await api(`/risk/recover/${encodeURIComponent(rec.rid)}/rollback`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            delete recovered.value[c.id];
            toast(`回收记录 #${rec.rid} 已回滚`, 'success');
            resultMsg.value = `回收记录 #${rec.rid} 已回滚，金币已退回 ${rec.toId}`;
            await load();
          } catch (e) {
            rollbackError.value = e.message;
          } finally {
            rollingBack.value = false;
          }
        }

        const manualRid = ref('');
        async function manualRollback() {
          const rid = manualRid.value.trim();
          if (!rid) return;
          const reason = await confirmDanger({
            title: '确认回滚回收记录',
            target: `回收记录 #${rid}`,
            action: '退回该回收记录金额给原净收款方',
            impact: '属于真实动账且不可撤销，请确认记录 ID 正确',
            danger: true,
          });
          if (!reason) return;
          rollingBack.value = true;
          rollbackError.value = '';
          try {
            await api(`/risk/recover/${encodeURIComponent(rid)}/rollback`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            });
            toast(`回收记录 #${rid} 已回滚`, 'success');
            manualRid.value = '';
            await load();
          } catch (e) {
            rollbackError.value = e.message;
          } finally {
            rollingBack.value = false;
          }
        }

        async function doLock(c) {
          const label = LOCK_LEVELS.find((l) => l.value === lockLevel.value)?.label || lockLevel.value;
          const reason = await confirmDanger({
            title: `确认封禁联动：${label}`,
            target: `线索 #${c.id}｜涉及玩家 ${c.fromId} / ${c.toId}`,
            action: `对涉事账号施加 ${label}（${lockLevel.value}）并冻结线索`,
            impact: lockLevel.value === 'ban' ? '账号将被封禁，且封禁无解封接口' : '账号交易被封锁，线索同时冻结',
            danger: true,
          });
          if (!reason) return;
          busy.value = true;
          try {
            await api(`/risk/cases/${encodeURIComponent(c.id)}/lock`, {
              method: 'POST',
              body: JSON.stringify({ level: lockLevel.value, reason }),
            });
            toast(`线索 #${c.id} 封禁联动已执行：${label}`, 'success');
            close();
            await load();
          } catch (e) {
            error.value = e.message;
          } finally {
            busy.value = false;
          }
        }

        function typeLabel(v) {
          return CASE_TYPE_LABEL[v] || v;
        }
        function statusLabel(v) {
          return CASE_STATUS_LABEL[v] || v;
        }
        function statusBadge(v) {
          if (v === 'open') return 'badge-red';
          if (v === 'frozen') return 'badge-yellow';
          return 'badge-gray';
        }
        function summary(c) {
          const wf = Array.isArray(c.wfIds) ? `流水 ${c.wfIds.length} 笔` : '';
          const detail = jsonText(c.detailJson);
          return [detail && detail !== '{}' ? detail : '', wf].filter(Boolean).join('；') || '-';
        }

        onMounted(load);

        return {
          status, caseType, list, loading, error, resultMsg, load, recovered,
          activeId, mode, lockLevel, busy, toggle, close,
          proposingId, propose, dispose, recoveringId, doRecover,
          rollingBack, rollbackError, doRollback, manualRid, manualRollback, doLock,
          typeLabel, statusLabel, statusBadge, summary, LOCK_LEVELS, fmtTime,
        };
      },
    },
  };
})();