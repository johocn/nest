import { JwtPayload } from '@modules/auth/auth.service';

/**
 * 租户解析优先级：
 *  1. JWT 载荷中的 tenantId（由登录/下发 token 环节写入，最权威）
 *  2. 请求头 x-tenant-id（运营方显式指定）
 *  3. 子域名前缀（如 acme.game.joho.cn → acme）
 *  4. 回退 'default'（兼容现有单租户）
 *
 * 单库多租户：所有卡牌/对局数据带 tenant_id 列，查询时统一按上下文加 where。
 */
export function resolveTenantId(
  payload?: JwtPayload | null,
  headers?: Record<string, any> | null,
  host?: string | null,
): string {
  const fromJwt = (payload as any)?.tenantId as string | undefined;
  if (fromJwt) return String(fromJwt);

  const fromHeader = headers?.['x-tenant-id'] || headers?.['X-Tenant-Id'];
  if (fromHeader) return String(fromHeader);

  if (host) {
    const sub = host.split('.')[0];
    if (sub && sub !== 'game' && sub !== 'www' && sub !== 'localhost') {
      return sub;
    }
  }
  return 'default';
}
