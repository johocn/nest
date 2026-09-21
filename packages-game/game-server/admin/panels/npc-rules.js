/**
 * 面板：NPC 规则与巡逻路径（出现规则 CRUD + 路点行内编辑）
 * 注册到 window.XGamePanels，由 index.html 按注册表渲染
 */
(function () {
  const { api, toast, confirmDanger, jsonText } = window.XGameCore;

  const RULE_TYPES = [
    { value: 'fixed', label: '固定出现', badge: 'badge-blue' },
    { value: 'random', label: '随机出现', badge: 'badge-yellow' },
    { value: 'patrol', label: '路径巡逻', badge: 'badge-green' },
  ];
  const LOOP_MODES = [
    { value: 'loop', label: '循环' },
    { value: 'pingpong', label: '往返' },
    { value: 'once', label: '单次' },
  ];

  window.XGamePanels = window.XGamePanels || {};
  window.XGamePanels['npc-rules'] = {
    label: 'NPC 规则',
    icon: 'ti ti-walk',
    order: 40,
    component: {
      template: `
        <div>
          <div class="card">
            <div class="card-header">
              <h3>NPC 出现规则</h3>
              <div class="filter-bar">
                <div class="form-group narrow">
                  <label>场景</label>
                  <select v-model="sceneId" @change="onSceneChange">
                    <option value="">请选择场景</option>
                    <option v-for="s in scenes" :key="s.id" :value="String(s.id)">{{ s.name }}（#{{ s.id }}）</option>
                  </select>
                </div>
                <button class="btn btn-secondary" @click="loadAll" :disabled="loading">刷新</button>
                <button class="btn btn-primary" @click="openRuleForm()" :disabled="!sceneId">+ 新建规则</button>
              </div>
            </div>
            <div class="card-body">
              <div v-if="error" class="alert alert-error">{{ error }}</div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>NPC 模板</th><th>坐标</th><th>半径</th><th>数量</th><th>条件</th><th>关联路径</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-if="loading"><td colspan="11" style="text-align:center;padding:24px"><span class="spinner"></span></td></tr>
                    <tr v-else-if="rules.length === 0"><td colspan="11" class="empty-state">暂无规则（先选场景，或用 seed:npc-demo 造演示数据）</td></tr>
                    <tr v-for="r in rules" :key="r.id">
                      <td>{{ r.id }}</td>
                      <td>{{ r.name }}</td>
                      <td><span class="badge" :class="typeBadge(r.ruleType)">{{ typeLabel(r.ruleType) }}</span></td>
                      <td>{{ r.npcTemplateId }}</td>
                      <td>{{ r.spawnX }}, {{ r.spawnY }}</td>
                      <td>{{ r.spawnRadius }}</td>
                      <td>{{ r.spawnCount }}</td>
                      <td>{{ conditionText(r.condition) }}</td>
                      <td>{{ r.patrolRouteId ? routeName(r.patrolRouteId) : '-' }}</td>
                      <td><span class="badge" :class="r.isActive ? 'badge-green' : 'badge-gray'">{{ r.isActive ? '启用' : '停用' }}</span></td>
                      <td>
                        <div class="row-actions">
                          <button class="btn btn-secondary btn-sm" @click="openRuleForm(r)">编辑</button>
                          <button class="btn btn-danger btn-sm" @click="removeRule(r)">删除</button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h3>NPC 巡逻路径</h3>
              <div class="filter-bar">
                <button class="btn btn-secondary" @click="loadAll" :disabled="loading">刷新</button>
                <button class="btn btn-primary" @click="openRouteForm()" :disabled="!sceneId">+ 新建路径</button>
              </div>
            </div>
            <div class="card-body">
              <div class="table-wrap">
                <table>
                  <thead><tr><th>ID</th><th>名称</th><th>NPC 模板</th><th>循环模式</th><th>速度(px/s)</th><th>路点数</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-if="loading"><td colspan="8" style="text-align:center;padding:24px"><span class="spinner"></span></td></tr>
                    <tr v-else-if="routes.length === 0"><td colspan="8" class="empty-state">暂无巡逻路径</td></tr>
                    <tr v-for="rt in routes" :key="rt.id">
                      <td>{{ rt.id }}</td>
                      <td>{{ rt.name }}</td>
                      <td>{{ rt.npcTemplateId }}</td>
                      <td>{{ loopLabel(rt.loopMode) }}</td>
                      <td>{{ rt.speed }}</td>
                      <td>{{ (rt.points || []).length }}</td>
                      <td><span class="badge" :class="rt.isActive ? 'badge-green' : 'badge-gray'">{{ rt.isActive ? '启用' : '停用' }}</span></td>
                      <td>
                        <div class="row-actions">
                          <button class="btn btn-secondary btn-sm" @click="openRouteForm(rt)">编辑</button>
                          <button class="btn btn-danger btn-sm" @click="removeRoute(rt)">删除</button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- 规则编辑弹窗 -->
          <div v-if="showRuleForm" class="modal-overlay" @click.self="showRuleForm = false">
            <div class="modal">
              <div class="modal-header">
                <h3>{{ ruleForm.id ? '编辑 NPC 规则' : '新建 NPC 规则' }}</h3>
                <button class="modal-close" @click="showRuleForm = false"><i class="ti ti-x"></i></button>
              </div>
              <div class="modal-body">
                <div class="form-group">
                  <label>名称</label>
                  <input v-model="ruleForm.name" maxlength="64" placeholder="如：村口巡逻守卫">
                </div>
                <div class="form-group">
                  <label>NPC 模板 ID</label>
                  <input v-model="ruleForm.npcTemplateId" placeholder="npc_templates.id">
                </div>
                <div class="form-group">
                  <label>规则类型</label>
                  <select v-model="ruleForm.ruleType">
                    <option v-for="t in RULE_TYPES" :key="t.value" :value="t.value">{{ t.label }}（{{ t.value }}）</option>
                  </select>
                </div>
                <div class="filter-bar">
                  <div class="form-group narrow">
                    <label>出生点 X</label>
                    <input v-model.number="ruleForm.spawnX" type="number" min="0">
                  </div>
                  <div class="form-group narrow">
                    <label>出生点 Y</label>
                    <input v-model.number="ruleForm.spawnY" type="number" min="0">
                  </div>
                </div>
                <div class="filter-bar" style="margin-top:16px">
                  <div class="form-group narrow">
                    <label>随机半径</label>
                    <input v-model.number="ruleForm.spawnRadius" type="number" min="0">
                  </div>
                  <div class="form-group narrow">
                    <label>生成数量</label>
                    <input v-model.number="ruleForm.spawnCount" type="number" min="1">
                  </div>
                </div>
                <div class="filter-bar" style="margin-top:16px">
                  <div class="form-group narrow">
                    <label>条件：最低等级</label>
                    <input v-model.number="ruleForm.minLevel" type="number" min="0" placeholder="留空不限制">
                  </div>
                  <div class="form-group narrow">
                    <label>条件：任务 ID</label>
                    <input v-model="ruleForm.questId" placeholder="留空不限制">
                  </div>
                </div>
                <div class="form-group" style="margin-top:16px" v-if="ruleForm.ruleType === 'patrol'">
                  <label>关联巡逻路径</label>
                  <select v-model="ruleForm.patrolRouteId">
                    <option value="">不关联</option>
                    <option v-for="rt in routes" :key="rt.id" :value="String(rt.id)">{{ rt.name }}（#{{ rt.id }}，{{ (rt.points || []).length }} 个路点）</option>
                  </select>
                </div>
                <div class="form-group">
                  <label><input type="checkbox" v-model="ruleForm.isActive" style="width:auto;margin-right:6px">启用该规则</label>
                </div>
                <div v-if="ruleError" class="alert alert-error">{{ ruleError }}</div>
                <div class="muted" v-if="currentScene">地图范围：X 0..{{ currentScene.mapWidth }}，Y 0..{{ currentScene.mapHeight }}</div>
              </div>
              <div class="modal-footer">
                <button class="btn btn-secondary" @click="showRuleForm = false">取消</button>
                <button class="btn btn-primary" @click="saveRule" :disabled="ruleSaving">{{ ruleSaving ? '保存中...' : '保存' }}</button>
              </div>
            </div>
          </div>

          <!-- 路径编辑弹窗 -->
          <div v-if="showRouteForm" class="modal-overlay" @click.self="showRouteForm = false">
            <div class="modal">
              <div class="modal-header">
                <h3>{{ routeForm.id ? '编辑巡逻路径' : '新建巡逻路径' }}</h3>
                <button class="modal-close" @click="showRouteForm = false"><i class="ti ti-x"></i></button>
              </div>
              <div class="modal-body">
                <div class="form-group">
                  <label>名称</label>
                  <input v-model="routeForm.name" maxlength="64" placeholder="如：铁匠铺环形巡逻">
                </div>
                <div class="form-group">
                  <label>NPC 模板 ID</label>
                  <input v-model="routeForm.npcTemplateId" placeholder="npc_templates.id">
                </div>
                <div class="filter-bar">
                  <div class="form-group narrow">
                    <label>循环模式</label>
                    <select v-model="routeForm.loopMode">
                      <option v-for="m in LOOP_MODES" :key="m.value" :value="m.value">{{ m.label }}（{{ m.value }}）</option>
                    </select>
                  </div>
                  <div class="form-group narrow">
                    <label>速度(px/s)</label>
                    <input v-model.number="routeForm.speed" type="number" min="1">
                  </div>
                </div>
                <div class="form-group" style="margin-top:16px">
                  <label><input type="checkbox" v-model="routeForm.isActive" style="width:auto;margin-right:6px">启用该路径</label>
                </div>
                <div class="card" style="margin:0">
                  <div class="card-header">
                    <h3>路点（按顺序巡逻）</h3>
                    <button class="btn btn-secondary btn-sm" @click="addPoint">+ 添加路点</button>
                  </div>
                  <div class="card-body" style="padding:12px">
                    <div class="table-wrap">
                      <table>
                        <thead><tr><th>#</th><th>X</th><th>Y</th><th>停留(s)</th><th>操作</th></tr></thead>
                        <tbody>
                          <tr v-if="routeForm.points.length === 0"><td colspan="5" class="empty-state" style="padding:16px">暂无路点，请添加</td></tr>
                          <tr v-for="(p, i) in routeForm.points" :key="i">
                            <td>{{ i + 1 }}</td>
                            <td><input v-model.number="p.x" type="number" min="0" style="width:90px;padding:6px 8px;border:1px solid var(--border);border-radius:6px"></td>
                            <td><input v-model.number="p.y" type="number" min="0" style="width:90px;padding:6px 8px;border:1px solid var(--border);border-radius:6px"></td>
                            <td><input v-model.number="p.pauseSec" type="number" min="0" style="width:80px;padding:6px 8px;border:1px solid var(--border);border-radius:6px"></td>
                            <td><button class="btn btn-danger btn-sm" @click="removePoint(i)">删除</button></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div class="muted" style="margin-top:8px" v-if="currentScene">地图范围：X 0..{{ currentScene.mapWidth }}，Y 0..{{ currentScene.mapHeight }}（超界服务端会拒绝）</div>
                  </div>
                </div>
                <div v-if="routeError" class="alert alert-error" style="margin-top:12px">{{ routeError }}</div>
              </div>
              <div class="modal-footer">
                <button class="btn btn-secondary" @click="showRouteForm = false">取消</button>
                <button class="btn btn-primary" @click="saveRoute" :disabled="routeSaving">{{ routeSaving ? '保存中...' : '保存' }}</button>
              </div>
            </div>
          </div>
        </div>`,
      setup() {
        const { ref, reactive, computed, onMounted } = Vue;

        const scenes = ref([]);
        const sceneId = ref('');
        const rules = ref([]);
        const routes = ref([]);
        const loading = ref(false);
        const error = ref('');

        const currentScene = computed(
          () => scenes.value.find((s) => String(s.id) === sceneId.value) || null,
        );

        function typeLabel(v) {
          return RULE_TYPES.find((t) => t.value === v)?.label || v;
        }
        function typeBadge(v) {
          return RULE_TYPES.find((t) => t.value === v)?.badge || 'badge-gray';
        }
        function loopLabel(v) {
          return LOOP_MODES.find((m) => m.value === v)?.label || v;
        }
        function routeName(id) {
          const rt = routes.value.find((r) => String(r.id) === String(id));
          return rt ? `${rt.name}（#${rt.id}）` : `#${id}`;
        }
        function conditionText(cond) {
          if (!cond || typeof cond !== 'object') return '-';
          const parts = [];
          if (cond.minLevel != null) parts.push(`等级≥${cond.minLevel}`);
          if (cond.questId != null && cond.questId !== '') parts.push(`任务#${cond.questId}`);
          const known = ['minLevel', 'questId'];
          const extra = Object.keys(cond).filter((k) => !known.includes(k));
          if (extra.length) parts.push(`其他:${jsonText(extra)}`);
          return parts.length ? parts.join('，') : '-';
        }

        /** 坐标范围校验（风险 #6：无拖拽，靠输入校验兜底） */
        function outOfRange(x, y, label) {
          const s = currentScene.value;
          if (!s) return '';
          if (typeof x === 'number' && s.mapWidth && (x < 0 || x > s.mapWidth)) {
            return `${label} X=${x} 超出地图范围 0..${s.mapWidth}`;
          }
          if (typeof y === 'number' && s.mapHeight && (y < 0 || y > s.mapHeight)) {
            return `${label} Y=${y} 超出地图范围 0..${s.mapHeight}`;
          }
          return '';
        }

        async function loadScenes() {
          const data = await api('/world/scene/list?page=1&limit=100');
          scenes.value = data?.items || data?.list || [];
          if (!sceneId.value && scenes.value.length) {
            sceneId.value = String(scenes.value[0].id);
          }
        }

        async function loadAll() {
          if (!sceneId.value) {
            rules.value = [];
            routes.value = [];
            return;
          }
          loading.value = true;
          error.value = '';
          try {
            const [ruleData, routeData] = await Promise.all([
              api(`/world/npc-rules/list?sceneId=${encodeURIComponent(sceneId.value)}`),
              api(`/world/npc-routes/list?sceneId=${encodeURIComponent(sceneId.value)}`),
            ]);
            rules.value = ruleData?.list || [];
            routes.value = routeData?.list || [];
          } catch (e) {
            rules.value = [];
            routes.value = [];
            error.value = e.message;
          } finally {
            loading.value = false;
          }
        }

        function onSceneChange() {
          loadAll();
        }

        // ---------- 规则 ----------
        const showRuleForm = ref(false);
        const ruleSaving = ref(false);
        const ruleError = ref('');
        const ruleForm = reactive({
          id: null,
          name: '',
          npcTemplateId: '',
          ruleType: 'fixed',
          spawnX: 0,
          spawnY: 0,
          spawnRadius: 0,
          spawnCount: 1,
          minLevel: null,
          questId: '',
          patrolRouteId: '',
          isActive: true,
        });

        function openRuleForm(rule) {
          ruleError.value = '';
          if (rule) {
            ruleForm.id = rule.id;
            ruleForm.name = rule.name || '';
            ruleForm.npcTemplateId = String(rule.npcTemplateId ?? '');
            ruleForm.ruleType = rule.ruleType || 'fixed';
            ruleForm.spawnX = rule.spawnX ?? 0;
            ruleForm.spawnY = rule.spawnY ?? 0;
            ruleForm.spawnRadius = rule.spawnRadius ?? 0;
            ruleForm.spawnCount = rule.spawnCount ?? 1;
            ruleForm.minLevel = rule.condition?.minLevel ?? null;
            ruleForm.questId = rule.condition?.questId != null ? String(rule.condition.questId) : '';
            ruleForm.patrolRouteId = rule.patrolRouteId ? String(rule.patrolRouteId) : '';
            ruleForm.isActive = rule.isActive !== false;
          } else {
            ruleForm.id = null;
            ruleForm.name = '';
            ruleForm.npcTemplateId = '';
            ruleForm.ruleType = 'fixed';
            ruleForm.spawnX = 0;
            ruleForm.spawnY = 0;
            ruleForm.spawnRadius = 0;
            ruleForm.spawnCount = 1;
            ruleForm.minLevel = null;
            ruleForm.questId = '';
            ruleForm.patrolRouteId = '';
            ruleForm.isActive = true;
          }
          showRuleForm.value = true;
        }

        function buildCondition() {
          const cond = {};
          if (ruleForm.minLevel != null && ruleForm.minLevel !== '') cond.minLevel = Number(ruleForm.minLevel);
          if (ruleForm.questId !== '' && ruleForm.questId != null) cond.questId = ruleForm.questId;
          return Object.keys(cond).length ? cond : null;
        }

        async function saveRule() {
          ruleError.value = '';
          if (!ruleForm.name.trim()) {
            ruleError.value = '请填写规则名称';
            return;
          }
          if (!ruleForm.npcTemplateId.trim()) {
            ruleError.value = '请填写 NPC 模板 ID';
            return;
          }
          const rangeErr = outOfRange(Number(ruleForm.spawnX), Number(ruleForm.spawnY), '出生点');
          if (rangeErr) {
            ruleError.value = rangeErr;
            toast(rangeErr, 'error');
            return;
          }
          if (Number(ruleForm.spawnCount) < 1) {
            ruleError.value = '生成数量至少为 1';
            return;
          }
          ruleSaving.value = true;
          try {
            const body = {
              sceneId: sceneId.value,
              npcTemplateId: ruleForm.npcTemplateId.trim(),
              ruleType: ruleForm.ruleType,
              spawnX: Number(ruleForm.spawnX) || 0,
              spawnY: Number(ruleForm.spawnY) || 0,
              spawnRadius: Number(ruleForm.spawnRadius) || 0,
              spawnCount: Number(ruleForm.spawnCount) || 1,
              condition: buildCondition(),
              patrolRouteId: ruleForm.patrolRouteId || null,
              name: ruleForm.name.trim(),
              isActive: !!ruleForm.isActive,
            };
            if (ruleForm.id) {
              await api(`/world/npc-rules/${encodeURIComponent(ruleForm.id)}`, {
                method: 'PUT',
                body: JSON.stringify(body),
              });
              toast(`规则 #${ruleForm.id} 已更新`, 'success');
            } else {
              await api('/world/npc-rules', { method: 'POST', body: JSON.stringify(body) });
              toast('规则已创建（重启服务端后生效）', 'success');
            }
            showRuleForm.value = false;
            await loadAll();
          } catch (e) {
            ruleError.value = e.message;
          } finally {
            ruleSaving.value = false;
          }
        }

        async function removeRule(rule) {
          const reason = await confirmDanger({
            title: '确认删除 NPC 规则',
            target: `规则 #${rule.id}｜${rule.name}｜${typeLabel(rule.ruleType)}`,
            action: '软删除该 NPC 出现规则',
            impact: '删除后该规则不再下发到客户端（数据仍在库中，可人工恢复）',
            danger: true,
          });
          if (!reason) return;
          try {
            await api(`/world/npc-rules/${encodeURIComponent(rule.id)}`, { method: 'DELETE' });
            toast(`规则 #${rule.id} 已删除`, 'success');
            await loadAll();
          } catch (e) {
            error.value = e.message;
          }
        }

        // ---------- 路径 ----------
        const showRouteForm = ref(false);
        const routeSaving = ref(false);
        const routeError = ref('');
        const routeForm = reactive({
          id: null,
          name: '',
          npcTemplateId: '',
          loopMode: 'loop',
          speed: 60,
          points: [],
          isActive: true,
        });

        function openRouteForm(route) {
          routeError.value = '';
          if (route) {
            routeForm.id = route.id;
            routeForm.name = route.name || '';
            routeForm.npcTemplateId = String(route.npcTemplateId ?? '');
            routeForm.loopMode = route.loopMode || 'loop';
            routeForm.speed = route.speed ?? 60;
            routeForm.points = (route.points || []).map((p) => ({
              x: p.x ?? 0,
              y: p.y ?? 0,
              pauseSec: p.pauseSec ?? 0,
            }));
            routeForm.isActive = route.isActive !== false;
          } else {
            routeForm.id = null;
            routeForm.name = '';
            routeForm.npcTemplateId = '';
            routeForm.loopMode = 'loop';
            routeForm.speed = 60;
            routeForm.points = [];
            routeForm.isActive = true;
          }
          showRouteForm.value = true;
        }

        function addPoint() {
          routeForm.points.push({ x: 0, y: 0, pauseSec: 0 });
        }
        function removePoint(i) {
          routeForm.points.splice(i, 1);
        }

        async function saveRoute() {
          routeError.value = '';
          if (!routeForm.name.trim()) {
            routeError.value = '请填写路径名称';
            return;
          }
          if (!routeForm.npcTemplateId.trim()) {
            routeError.value = '请填写 NPC 模板 ID';
            return;
          }
          if (Number(routeForm.speed) < 1) {
            routeError.value = '速度至少为 1 px/s';
            return;
          }
          for (let i = 0; i < routeForm.points.length; i++) {
            const p = routeForm.points[i];
            const rangeErr = outOfRange(Number(p.x), Number(p.y), `路点 ${i + 1}`);
            if (rangeErr) {
              routeError.value = rangeErr;
              toast(rangeErr, 'error');
              return;
            }
          }
          routeSaving.value = true;
          try {
            const body = {
              sceneId: sceneId.value,
              npcTemplateId: routeForm.npcTemplateId.trim(),
              name: routeForm.name.trim(),
              loopMode: routeForm.loopMode,
              speed: Number(routeForm.speed) || 60,
              points: routeForm.points.map((p) => ({
                x: Number(p.x) || 0,
                y: Number(p.y) || 0,
                pauseSec: Number(p.pauseSec) || 0,
              })),
              isActive: !!routeForm.isActive,
            };
            if (routeForm.id) {
              await api(`/world/npc-routes/${encodeURIComponent(routeForm.id)}`, {
                method: 'PUT',
                body: JSON.stringify(body),
              });
              toast(`路径 #${routeForm.id} 已更新`, 'success');
            } else {
              await api('/world/npc-routes', { method: 'POST', body: JSON.stringify(body) });
              toast('路径已创建（重启服务端后生效）', 'success');
            }
            showRouteForm.value = false;
            await loadAll();
          } catch (e) {
            routeError.value = e.message;
          } finally {
            routeSaving.value = false;
          }
        }

        async function removeRoute(route) {
          const reason = await confirmDanger({
            title: '确认删除巡逻路径',
            target: `路径 #${route.id}｜${route.name}｜${(route.points || []).length} 个路点`,
            action: '软删除该巡逻路径',
            impact: '引用该路径的规则将失去路点（数据仍在库中，可人工恢复）',
            danger: true,
          });
          if (!reason) return;
          try {
            await api(`/world/npc-routes/${encodeURIComponent(route.id)}`, { method: 'DELETE' });
            toast(`路径 #${route.id} 已删除`, 'success');
            await loadAll();
          } catch (e) {
            error.value = e.message;
          }
        }

        async function init() {
          loading.value = true;
          try {
            await loadScenes();
          } catch (e) {
            error.value = e.message;
          } finally {
            loading.value = false;
          }
          await loadAll();
        }

        onMounted(init);

        return {
          scenes, sceneId, currentScene, rules, routes, loading, error,
          RULE_TYPES, LOOP_MODES,
          typeLabel, typeBadge, loopLabel, routeName, conditionText,
          loadAll, onSceneChange,
          showRuleForm, ruleForm, ruleSaving, ruleError, openRuleForm, saveRule, removeRule,
          showRouteForm, routeForm, routeSaving, routeError,
          openRouteForm, addPoint, removePoint, saveRoute, removeRoute,
        };
      },
    },
  };
})();
