/**
 * 平台差异唯一出口：业务代码不得直接访问 document / localStorage / wx。
 * S1 只实现 H5 分支；微信小游戏分支在 S7 补齐。
 */
export const Platform = {
  isMiniGame(): boolean {
    return typeof (globalThis as any).wx !== 'undefined' && typeof document === 'undefined';
  },

  storageGet(key: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  },

  storageSet(key: string, value: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  },

  storageRemove(key: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  },

  /**
   * 读取小游戏包内文本文件（相对于小游戏根目录）。
   * 小游戏环境没有 fetch 与 DOM，配置包随包分发后用本方法读取。
   */
  readLocalText(relPath: string): string | null {
    const wx = (globalThis as any).wx;
    if (!wx || typeof wx.getFileSystemManager !== 'function') return null;
    try {
      return wx.getFileSystemManager().readFileSync(relPath, 'utf8') as string;
    } catch (e) {
      console.warn(`[S1] 读取包内文件失败 ${relPath}`, e);
      return null;
    }
  },

  // 提示出口已迁到引擎内自绘 `ui/Hud.ts`（双端一致），此处不再有 DOM 提示实现。
  // `showLoginForm` / `hideLoginForm` 是 H5 特有能力的适配，保留在此。
  showLoginForm(handlers: {
    onSubmit: (username: string, password: string) => Promise<void>;
  }): void {
    if (typeof document === 'undefined') {
      throw new Error('当前平台不支持 DOM 登录表单');
    }
    this.hideLoginForm();
    const box = document.createElement('div');
    box.id = 's1-login';
    box.innerHTML = `
      <h2>江湖录 · S1 Spike</h2>
      <label for="s1-user">账号（3-32 位字母/数字/下划线）</label>
      <input id="s1-user" value="spike01" autocomplete="username" />
      <label for="s1-pass">密码（6-64 位）</label>
      <input id="s1-pass" type="password" value="spike123456" autocomplete="current-password" />
      <button id="s1-submit">登录 / 自动注册</button>
      <div class="err" id="s1-err"></div>
    `;
    document.body.appendChild(box);

    const user = box.querySelector('#s1-user') as HTMLInputElement;
    const pass = box.querySelector('#s1-pass') as HTMLInputElement;
    const err = box.querySelector('#s1-err') as HTMLDivElement;
    const btn = box.querySelector('#s1-submit') as HTMLButtonElement;

    btn.addEventListener('click', () => {
      err.textContent = '';
      btn.disabled = true;
      // tsconfig 的 lib 为 ES2017（无 Promise.prototype.finally），故用 try/finally 等价实现
      void (async () => {
        try {
          await handlers.onSubmit(user.value.trim(), pass.value);
        } catch (e: unknown) {
          err.textContent = e instanceof Error ? e.message : String(e);
        } finally {
          btn.disabled = false;
        }
      })();
    });
  },

  hideLoginForm(): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('s1-login');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  },
};