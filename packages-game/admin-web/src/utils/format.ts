/** 递归格式化对象成 key:value 单行字符串，支持嵌套对象与数组 */
export function fmtValue(v: any, depth = 0): string {
  if (v == null) return '-';
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return v.map((x) => fmtValue(x, depth + 1)).join(', ');
  const parts = Object.entries(v).map(([k, val]) => {
    if (typeof val === 'object' && val !== null) {
      return `${k}:{${fmtValue(val, depth + 1)}}`;
    }
    return `${k}:${String(val)}`;
  });
  return parts.join(', ');
}

/** 限制字符串长度，超出截断 */
export function truncate(s: string, max = 200): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '...' : s;
}
