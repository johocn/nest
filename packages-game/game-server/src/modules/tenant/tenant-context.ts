import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

/** 单请求内的租户上下文（运营商级数据隔离） */
export interface TenantContext {
  /** 运营商/渠道租户 id；未解析时为 'default'（单租户兼容） */
  tenantId: string;
}

/**
 * 基于 AsyncLocalStorage 的租户上下文。
 * 在网关/HTTP 中间件里解析出 tenantId 后 runWith 包裹请求处理，
 * 仓储与实体统一从上下文取 tenantId，实现逻辑隔离（共享表 + tenant_id 列）。
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();
  private static readonly DEFAULT = 'default';

  run<T>(tenantId: string, fn: () => T): T {
    return this.storage.run({ tenantId: tenantId || TenantContextService.DEFAULT }, fn);
  }

  getTenantId(): string {
    return this.storage.getStore()?.tenantId ?? TenantContextService.DEFAULT;
  }

  hasTenant(): boolean {
    return !!this.storage.getStore();
  }
}
