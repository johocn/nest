import { Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context';

/** 运营商级（多租户）数据隔离基础设施：租户上下文 + 解析策略。 */
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantModule {}
