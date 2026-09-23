import { AppConfig } from '../config/AppConfig';
import { Hud } from '../ui/Hud';

/**
 * 平台差异唯一出口：业务代码不得直接访问 document / localStorage / wx。
 * 存储 / 提示 / 环境地址三域已双端适配（S7 Task 1）；网络与登录页见 S7 后续任务。
 */

/** Platform.request 入参：只暴露业务代码真正需要的最小集 */
export interface PlatformRequestOptions {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Platform.request 出参：不解析 JSON，交给 http.ts 沿用既有解析与错误语义 */
export interface PlatformResponse {
  status: number;
  text: string;
}

/**
 * 小游戏全局对象。存储分支按「wx 存在且方法为 function」判定，不用 isMiniGame()：
 * 开发者工具里 document 可能仍存在，按 document 判定会走错分支。
 */
function wxApi(): any {
  const w = (globalThis as any).wx;
  return w && typeof w === 'object' ? w : null;
}

/** 构建期注入的环境覆盖（globalThis.__ENV__）：仅当字段是非空字符串时生效 */
function envValue(key: 'apiBase' | 'wsUrl'): string | null {
  const env = (globalThis as any).__ENV__;
  if (!env || typeof env !== 'object') return null;
  const v = env[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** 接口根地址：注入值优先，否则 AppConfig 默认（dev）；去掉尾部 / 避免拼出 // */
function resolveApiBase(): string {
  return (envValue('apiBase') ?? AppConfig.apiBase).replace(/\/+$/, '');
}

function resolveWsUrl(): string {
  return envValue('wsUrl') ?? AppConfig.wsUrl;
}

export const Platform = {
  isMiniGame(): boolean {
    return typeof (globalThis as any).wx !== 'undefined' && typeof document === 'undefined';
  },

  storageGet(key: string): string | null {
    const wx = wxApi();
    if (wx && typeof wx.getStorageSync === 'function') {
      try {
        const v = wx.getStorageSync(key);
        // wx 用 '' 表示键不存在，与 localStorage.getItem 的 null 对齐
        return v === '' || v === null || v === undefined ? null : (v as string);
      } catch (e) {
        console.warn(`[S7] wx.getStorageSync 失败 ${key}`, e);
        return null;
      }
    }
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  },

  storageSet(key: string, value: string): void {
    const wx = wxApi();
    if (wx && typeof wx.setStorageSync === 'function') {
      try {
        wx.setStorageSync(key, value);
      } catch (e) {
        console.warn(`[S7] wx.setStorageSync 失败 ${key}`, e);
      }
      return;
    }
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  },

  storageRemove(key: string): void {
    const wx = wxApi();
    if (wx && typeof wx.removeStorageSync === 'function') {
      try {
        wx.removeStorageSync(key);
      } catch (e) {
        console.warn(`[S7] wx.removeStorageSync 失败 ${key}`, e);
      }
      return;
    }
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

  /**
   * 网络出口：H5 用 fetch，小游戏用 wx.request，统一返回 { status, text }。
   * 只做传输差异适配，不解析响应体 —— 业务错误约定（body.code 优先）仍由 net/http.ts 负责。
   *
   * wx 分支必须显式 dataType:'text'：否则 wx 会把 JSON 响应体预解析成对象，text 就不是原文。
   * 分支判定与存储一致（wx 存在且 request 为 function），wx 不可用时回落 fetch。
   */
  async request(opts: PlatformRequestOptions): Promise<PlatformResponse> {
    const wx = wxApi();
    if (wx && typeof wx.request === 'function') {
      return new Promise<PlatformResponse>((resolve, reject) => {
        wx.request({
          url: opts.url,
          method: opts.method,
          header: opts.headers,
          data: opts.body,
          dataType: 'text',
          success(res: any) {
            resolve({
              status: res.statusCode,
              // 非字符串只是兜底（dataType:'text' 生效时 data 必为 string）
              text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
            });
          },
          fail(err: any) {
            reject(new Error(`wx.request 失败：${(err && err.errMsg) || JSON.stringify(err)}`));
          },
        });
      });
    }

    const res = await fetch(opts.url, { method: opts.method, headers: opts.headers, body: opts.body });
    return { status: res.status, text: await res.text() };
  },

  /**
   * 提示出口：引擎内自绘 `ui/Hud.ts`，双端一致、不依赖 DOM。
   * Hud 未初始化（引擎未起来）时其自身降级为 console，此处不再重复判断。
   */
  ui: {
    toast(text: string, ms?: number): void {
      Hud.toast(text, ms ?? AppConfig.hud.toastMs);
    },
  },

  /** 环境地址解析：注入值（globalThis.__ENV__）优先，否则 AppConfig 默认（dev） */
  env: {
    apiBase(): string {
      return resolveApiBase();
    },

    wsUrl(): string {
      return resolveWsUrl();
    },

    /** 实际生效的地址（日志/断言用） */
    raw(): { apiBase: string; wsUrl: string } {
      return { apiBase: resolveApiBase(), wsUrl: resolveWsUrl() };
    },
  },

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