/**
 * XGame 管理后台共享层（零构建：直接 <script src> 引入）
 * 暴露 window.XGameCore：api / toast / confirmDanger / fmtTime / jsonText
 */
(function () {
  const BASE_URL = '/api/admin/v1';
  const TOKEN_KEY = 'xgame_token';
  const ADMIN_KEY = 'xgame_admin';

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
  }

  /** 统一请求：注入 Bearer；401 清登录态并回登录页；业务码非 0 抛中文 msg；成功返回 data */
  async function api(path, opts) {
    const o = opts || {};
    const url = path.startsWith('/api/') ? path : BASE_URL + path;
    const res = await fetch(url, {
      ...o,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
        ...(o.headers || {}),
      },
    });
    if (res.status === 401) {
      clearAuth();
      toast('登录已过期，请重新登录', 'error');
      setTimeout(() => location.reload(), 800);
      throw new Error('登录已过期');
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const msg = (body && (body.msg || body.message)) || `请求失败 ${res.status}`;
    if (!res.ok) throw new Error(msg);
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code !== 0) throw new Error(body.msg || msg);
      return body.data;
    }
    return body;
  }

  function toast(msg, type) {
    let box = document.getElementById('xg-toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'xg-toast-box';
      box.className = 'xg-toast-box';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `xg-toast xg-toast-${type || 'info'}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  /**
   * 危险动作二次确认：展示目标/动作/影响，理由必填（≥2 字）。
   * @returns {Promise<string|null>} 确认时 resolve 理由文本；取消时 resolve null（调用方不得发请求）
   */
  function confirmDanger(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'xg-modal-overlay';
      overlay.innerHTML = `
        <div class="xg-modal">
          <div class="xg-modal-header${o.danger ? ' xg-danger' : ''}"><h3></h3></div>
          <div class="xg-modal-body">
            <div class="xg-row"><span class="xg-row-label">目标</span><span class="xg-row-val" data-xg="target"></span></div>
            <div class="xg-row"><span class="xg-row-label">动作</span><span class="xg-row-val" data-xg="action"></span></div>
            <div class="xg-row"><span class="xg-row-label">影响</span><span class="xg-row-val" data-xg="impact"></span></div>
            ${o.danger ? '<div class="xg-danger-tip">该动作不可撤销，请确认已核对目标</div>' : ''}
            <div class="form-group" style="margin-top:14px;margin-bottom:0">
              <label>操作理由（必填，至少 2 个字，写入审计）</label>
              <textarea data-xg="reason" rows="3" placeholder="请填写处置理由"></textarea>
            </div>
            <div class="xg-modal-err" data-xg="err" style="display:none"></div>
          </div>
          <div class="xg-modal-footer">
            <button class="btn btn-secondary" data-xg="cancel">取消</button>
            <button class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" data-xg="ok">确认执行</button>
          </div>
        </div>`;

      // 所有动态文本统一 textContent 赋值，避免管理端 XSS
      const set = (key, val) => {
        const el = overlay.querySelector(`[data-xg="${key}"]`);
        if (el) el.textContent = val == null || val === '' ? '-' : String(val);
      };
      overlay.querySelector('h3').textContent = o.title || '确认执行';
      set('target', o.target);
      set('action', o.action);
      set('impact', o.impact);

      const reasonEl = overlay.querySelector('[data-xg="reason"]');
      const errEl = overlay.querySelector('[data-xg="err"]');
      let done = false;

      const close = (val) => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(null);
      };

      overlay.querySelector('[data-xg="cancel"]').onclick = () => close(null);
      overlay.onclick = (e) => {
        if (e.target === overlay) close(null);
      };
      overlay.querySelector('[data-xg="ok"]').onclick = () => {
        const reason = (reasonEl.value || '').trim();
        if (reason.length < 2) {
          errEl.textContent = '请填写操作理由（至少 2 个字）';
          errEl.style.display = 'block';
          reasonEl.focus();
          return;
        }
        close(reason);
      };

      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      reasonEl.focus();
    });
  }

  function fmtTime(t) {
    if (!t) return '-';
    try {
      return new Date(t).toLocaleString('zh-CN');
    } catch {
      return String(t);
    }
  }

  /** 玩家可控/后端任意结构文本化（用于表格里展示 jsonb 摘要），只做文本，不注入 HTML */
  function jsonText(v) {
    if (v == null) return '-';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  window.XGameCore = { api, toast, confirmDanger, fmtTime, jsonText, BASE_URL };
})();