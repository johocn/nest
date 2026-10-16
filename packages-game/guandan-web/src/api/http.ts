// 精简的 HTTP 工具：基于 fetch，默认相对路径（由 Vite 代理转发到后端）。
const BASE = import.meta.env.VITE_API_BASE || '';

export async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data?.code && data.code !== 200) {
    throw new Error(data.msg || '请求失败');
  }
  return data.data as T;
}
