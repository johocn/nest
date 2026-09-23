import { Platform, PlatformResponse } from '../platform/Platform';

export class ApiError extends Error {
  constructor(
    public readonly code: number,
    msg: string,
  ) {
    super(msg);
    this.name = 'ApiError';
  }
}

export interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
}

/**
 * 后端约定：业务错误也是 HTTP 200，错误信息在 body.code / body.msg。
 * 因此必须优先看 body.code，而不是 HTTP status。
 */
export async function httpJson<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: { token?: string | null; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  let res: PlatformResponse;
  try {
    res = await Platform.request({
      method,
      url: `${Platform.env.apiBase()}${path}`,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    throw new ApiError(-1, `无法连接后端 ${Platform.env.apiBase()}（请确认服务已启动且 CORS 放行）`);
  }

  const text = res.text;
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, `响应不是 JSON：${text.slice(0, 120)}`);
  }

  if (payload && typeof payload.code === 'number') {
    if (payload.code !== 0) throw new ApiError(payload.code, payload.msg || '请求失败');
    return payload.data as T;
  }
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, `HTTP ${res.status}`);
  return payload as T;
}