/**
 * GM DOM Panel 注入器 —— 运行时向页面注入 GM 控制台
 * 不依赖 Vite/Webpack ?raw 导入，纯运行时 DOM 操作
 *
 * 源文件位于 src/gm-panel/ (style.css / index.html / gm.js)
 * 以下 CSS / HTML / JS 字符串即从源文件拷贝嵌入
 */

const GM_PANEL_CSS = `/* GM 面板 —— 暗色主题 overlay */
#gm-panel {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 480px;
  height: 420px;
  z-index: 9999;
  background: #1a1a2e;
  border: 1px solid #3d3d5c;
  border-radius: 8px;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#gm-panel[hidden] { display: none !important; }
#gm-panel .gm-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #16213e;
  border-bottom: 1px solid #3d3d5c;
  cursor: move;
  user-select: none;
}
#gm-panel .gm-header .gm-title { font-weight: 600; font-size: 14px; color: #e94560; letter-spacing: 1px; }
#gm-panel .gm-header .gm-close { background: transparent; border: none; color: #aaa; cursor: pointer; font-size: 18px; padding: 0 4px; line-height: 1; }
#gm-panel .gm-header .gm-close:hover { color: #e94560; }
#gm-panel .gm-body { flex: 1; display: flex; min-height: 0; }
#gm-panel .gm-sidebar { flex-shrink: 0; width: 130px; background: #0f0f1a; border-right: 1px solid #3d3d5c; overflow-y: auto; padding: 6px 0; }
#gm-panel .gm-sidebar .gm-cmd-item { padding: 7px 12px; cursor: pointer; border-left: 3px solid transparent; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: #b0b0b0; }
#gm-panel .gm-sidebar .gm-cmd-item:hover { background: rgba(233, 69, 96, 0.1); color: #fff; }
#gm-panel .gm-sidebar .gm-cmd-item.gm-active { background: rgba(233, 69, 96, 0.2); border-left-color: #e94560; color: #fff; }
#gm-panel .gm-content { flex: 1; display: flex; flex-direction: column; padding: 10px 14px; min-width: 0; gap: 8px; }
#gm-panel .gm-login-form { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 10px; text-align: center; }
#gm-panel .gm-login-form input { background: #0f0f1a; border: 1px solid #3d3d5c; border-radius: 4px; color: #e0e0e0; padding: 7px 10px; font-size: 13px; outline: none; }
#gm-panel .gm-login-form input:focus { border-color: #e94560; }
#gm-panel .gm-login-form button, #gm-panel .gm-exec-btn { background: #e94560; color: #fff; border: none; border-radius: 4px; padding: 7px 16px; cursor: pointer; font-size: 13px; font-weight: 500; }
#gm-panel .gm-login-form button:hover, #gm-panel .gm-exec-btn:hover { background: #c73652; }
#gm-panel .gm-login-form button:disabled, #gm-panel .gm-exec-btn:disabled { background: #555; cursor: not-allowed; }
#gm-panel .gm-args-area { flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; max-height: 140px; overflow-y: auto; }
#gm-panel .gm-args-area label { font-size: 11px; color: #888; }
#gm-panel .gm-args-area input, #gm-panel .gm-args-area textarea, #gm-panel .gm-player-id { background: #0f0f1a; border: 1px solid #3d3d5c; border-radius: 4px; color: #e0e0e0; padding: 6px 8px; font-size: 12px; outline: none; width: 100%; box-sizing: border-box; }
#gm-panel .gm-args-area input:focus, #gm-panel .gm-args-area textarea:focus, #gm-panel .gm-player-id:focus { border-color: #e94560; }
#gm-panel .gm-player-row { flex-shrink: 0; display: flex; gap: 8px; align-items: center; }
#gm-panel .gm-player-id { flex: 1; }
#gm-panel .gm-exec-btn { flex-shrink: 0; }
#gm-panel .gm-log { flex: 1; background: #0f0f1a; border-radius: 4px; padding: 8px 10px; font-family: "Consolas", "Courier New", monospace; font-size: 11px; overflow-y: auto; color: #b0b0b0; white-space: pre-wrap; word-break: break-all; }
#gm-panel .gm-log .gm-ok { color: #4caf50; }
#gm-panel .gm-log .gm-err { color: #f44336; }
#gm-panel .gm-log .gm-info { color: #64b5f6; }
`;

const GM_PANEL_HTML = `<div id="gm-panel" hidden>
  <div class="gm-header">
    <span class="gm-title">GM 控制台</span>
    <button class="gm-close" title="关闭 (Ctrl+G / ~)" onclick="window.__toggleGMPanel()">&#x2715;</button>
  </div>
  <div class="gm-body">
    <div class="gm-sidebar"></div>
    <div class="gm-content">
      <div class="gm-login-form" id="gm-login-form" hidden>
        <div style="margin-bottom: 6px; color: #888; font-size: 12px;">请先登录管理员账号</div>
        <input type="text" id="gm-admin-user" placeholder="Admin 用户名" />
        <input type="password" id="gm-admin-pass" placeholder="Admin 密码" />
        <button id="gm-login-btn">登录</button>
        <div style="color: #666; font-size: 11px; margin-top: 4px;">登录后 token 存于 localStorage.admin_token</div>
      </div>
      <template id="gm-main-tpl">
        <div class="gm-player-row">
          <input type="text" class="gm-player-id" placeholder="目标玩家 ID (可选)" />
          <button class="gm-exec-btn">执行</button>
        </div>
        <div class="gm-args-area"></div>
        <div class="gm-log"></div>
      </template>
    </div>
  </div>
</div>`;

const GM_PANEL_JS = `(function () {
  'use strict';
  var API_BASE = '/api';
  function isWeChatMiniGame() {
    try {
      if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') return true;
      if (typeof GameGlobal !== 'undefined') return true;
    } catch (e) {}
    return false;
  }
  function getAdminToken() { try { return localStorage.getItem('admin_token') || ''; } catch (e) { return ''; } }
  function setAdminToken(t) { try { localStorage.setItem('admin_token', t || ''); } catch (e) {} }
  function apiFetch(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var token = getAdminToken();
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(API_BASE + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return data; });
    });
  }
  var _cmds = [], _selected = null, _args = {};
  function log(html, cls) {
    var logEl = document.querySelector('#gm-panel .gm-log');
    if (!logEl) return;
    var div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = html;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function switchLoginUI() {
    var loginForm = document.getElementById('gm-login-form');
    var mainTpl = document.getElementById('gm-main-tpl');
    var content = document.querySelector('#gm-panel .gm-content');
    if (!content) return;
    content.innerHTML = '';
    if (!getAdminToken()) {
      loginForm.hidden = false;
      content.appendChild(loginForm);
    } else {
      loginForm.hidden = true;
      var frag = document.createElement('div');
      while (mainTpl.children.length > 0) frag.appendChild(mainTpl.children[0]);
      content.appendChild(frag);
      var execBtn = content.querySelector('.gm-exec-btn');
      if (execBtn) execBtn.addEventListener('click', execute);
    }
  }
  async function loadCmds() {
    try {
      var data = await apiFetch('/admin/v1/ops/gm/list', { method: 'GET' });
      _cmds = (data && data.data) || (Array.isArray(data) ? data : []);
      renderSidebar();
      if (_cmds.length === 0) log('[GM] 未获取到 GM 命令', 'info');
    } catch (err) { log('[GM] 命令列表加载失败: ' + (err && err.message || String(err)), 'err'); }
  }
  function renderSidebar() {
    var sidebar = document.querySelector('#gm-panel .gm-sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = '';
    if (!_cmds.length) { sidebar.innerHTML = '<div style="padding:10px;color:#666;font-size:11px;text-align:center;">无命令</div>'; return; }
    _cmds.forEach(function (cmd) {
      var item = document.createElement('div');
      item.className = 'gm-cmd-item';
      item.textContent = cmd.name;
      item.title = cmd.description || cmd.name;
      item.dataset.name = cmd.name;
      item.addEventListener('click', function () { selectCmd(cmd.name); });
      sidebar.appendChild(item);
    });
  }
  function selectCmd(name) {
    _selected = name; _args = {};
    document.querySelectorAll('#gm-panel .gm-cmd-item').forEach(function (el) { el.classList.toggle('gm-active', el.dataset.name === name); });
    var area = document.querySelector('#gm-panel .gm-args-area');
    if (!area) return; area.innerHTML = '';
    var cmd = _cmds.find(function (c) { return c.name === name; });
    if (!cmd || !cmd.argsSchema) return;
    Object.keys(cmd.argsSchema).forEach(function (k) {
      var sch = cmd.argsSchema[k];
      var label = document.createElement('label');
      label.textContent = k + (sch.description ? ' (' + sch.description + ')' : '');
      var input = document.createElement('input');
      input.type = 'text'; input.dataset.key = k; input.dataset.type = sch.type || 'string';
      input.placeholder = sch.type || 'string';
      input.addEventListener('input', function () { _args[k] = coerce(input.value, sch.type); });
      area.appendChild(label); area.appendChild(input);
    });
  }
  function coerce(val, type) {
    if (val === undefined || val === null || val === '') return val;
    if (type === 'number') return Number(val);
    if (type === 'boolean') return val === 'true' || val === '1' || val === 'yes';
    return String(val);
  }
  async function execute() {
    if (!_selected) { log('请先选择 GM 命令', 'err'); return; }
    var playerInput = document.querySelector('#gm-panel .gm-player-id');
    var targetPlayerId = playerInput ? playerInput.value.trim() : '';
    var payload = { cmd: _selected, args: _args };
    if (targetPlayerId) payload.targetPlayerId = targetPlayerId;
    log('> ' + _selected + ' ' + JSON.stringify(payload), 'info');
    try {
      var res = await apiFetch('/admin/v1/ops/gm/execute', { method: 'POST', body: payload });
      if (res && res.data) {
        var d = res.data;
        var ok = d.ok !== false;
        var cls = ok ? 'gm-ok' : 'gm-err';
        var text = (ok ? 'OK ' : 'FAIL ') + (d.logId || '') + ' ';
        if (d.error) text += 'error=' + d.error;
        if (d.result !== undefined && d.result !== null) {
          text += ' result=' + (typeof d.result === 'string' ? d.result : JSON.stringify(d.result));
        }
        log(text, cls);
      } else { log('响应异常: ' + JSON.stringify(res), 'err'); }
    } catch (err) { log('[GM] 执行异常: ' + (err && err.message || String(err)), 'err'); }
  }
  async function adminLogin() {
    var u = document.getElementById('gm-admin-user');
    var p = document.getElementById('gm-admin-pass');
    var btn = document.getElementById('gm-login-btn');
    var username = u ? u.value.trim() : '';
    var password = p ? p.value : '';
    if (!username || !password) { log('请输入用户名和密码', 'err'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '登录中...'; }
    try {
      var res = await apiFetch('/admin/v1/auth/login', { method: 'POST', body: { username: username, password: password } });
      var token = (res && (res.data && (res.data.token || res.data.accessToken) || res.token)) || '';
      if (!token) { log('登录失败: 未返回 token —— ' + JSON.stringify(res).slice(0, 200), 'err'); return; }
      setAdminToken(token);
      try { localStorage.setItem('gm_admin_user', username); } catch (e) {}
      log('[GM] 登录成功', 'gm-ok');
      switchLoginUI(); loadCmds();
    } catch (err) { log('[GM] 登录请求失败: ' + (err && err.message || String(err)), 'err'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '登录'; } }
  }
  function initGMPanel() {
    if (isWeChatMiniGame()) { console.warn('[GM] 微信小游戏环境不支持 DOM GM 面板'); return; }
    var panel = document.getElementById('gm-panel');
    if (!panel) { console.warn('[GM] 未找到 #gm-panel'); return; }
    var loginBtn = document.getElementById('gm-login-btn');
    if (loginBtn) loginBtn.addEventListener('click', adminLogin);
    var u = document.getElementById('gm-admin-user');
    if (u) { try { u.value = localStorage.getItem('gm_admin_user') || ''; } catch (e) {} }
    switchLoginUI();
    if (getAdminToken()) loadCmds();
    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        if (ev.ctrlKey && (ev.key === 'g' || ev.key === 'G')) { ev.preventDefault(); toggleGMPanel(); }
        return;
      }
      if (ev.key === '\`' || ev.key === '~' || (ev.ctrlKey && (ev.key === 'g' || ev.key === 'G'))) {
        ev.preventDefault(); toggleGMPanel();
      }
    });
    var closeBtn = document.querySelector('#gm-panel .gm-close');
    if (closeBtn) closeBtn.addEventListener('click', toggleGMPanel);
    var header = document.querySelector('#gm-panel .gm-header');
    if (header) {
      var dragging = false, offX = 0, offY = 0;
      header.addEventListener('mousedown', function (ev) {
        if (ev.target.closest('.gm-close')) return;
        dragging = true;
        var rect = panel.getBoundingClientRect();
        offX = ev.clientX - rect.left; offY = ev.clientY - rect.top;
      });
      document.addEventListener('mousemove', function (ev) {
        if (!dragging) return;
        panel.style.left = (ev.clientX - offX) + 'px';
        panel.style.top = (ev.clientY - offY) + 'px';
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', function () { dragging = false; });
    }
  }
  function toggleGMPanel() {
    var panel = document.getElementById('gm-panel');
    if (!panel) return;
    if (panel.hasAttribute('hidden')) { panel.removeAttribute('hidden'); if (getAdminToken()) loadCmds(); }
    else { panel.setAttribute('hidden', ''); }
  }
  window.__initGMPanel = initGMPanel;
  window.__toggleGMPanel = toggleGMPanel;
  window.__gmPanelLogin = adminLogin;
})();`;

/**
 * 向 DOM 注入 GM panel 的 CSS / HTML / JS
 * 微信小游戏环境会在 JS 中自动 guard
 */
export function injectGMPanel(): void {
  if (typeof document === 'undefined') return;

  // 防止重复注入
  if (document.getElementById('gm-panel')) {
    // 已存在但可能被 hidden，确保初始化函数存在
    if (typeof (window as any).__initGMPanel === 'function') {
      try { (window as any).__initGMPanel(); } catch (e) { /* ignore */ }
    }
    return;
  }

  // CSS
  const styleEl = document.createElement('style');
  styleEl.textContent = GM_PANEL_CSS;
  document.head.appendChild(styleEl);

  // HTML
  const htmlEl = document.createElement('div');
  htmlEl.innerHTML = GM_PANEL_HTML;
  // innerHTML 不会把 template 里的子元素真正移入，用 children 拷贝
  const panelNode = htmlEl.firstElementChild;
  if (panelNode) {
    document.body.appendChild(panelNode);
  } else {
    document.body.appendChild(htmlEl);
  }

  // JS
  const scriptEl = document.createElement('script');
  scriptEl.textContent = GM_PANEL_JS;
  document.body.appendChild(scriptEl);

  // Init
  if (typeof (window as any).__initGMPanel === 'function') {
    try {
      (window as any).__initGMPanel();
    } catch (err) {
      console.warn('[GM] initGMPanel 异常:', err);
    }
  }
}
