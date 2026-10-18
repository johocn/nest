import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TraceService, traceService } from './trace.service';
import { TraceMiddleware } from './trace.middleware';
import { GameTraceInterceptor } from './trace.interceptor';
import { TraceController } from './trace.controller';

/**
 * TraceModule —— 轻量链路追踪（零外部依赖）
 *
 * 注册后：
 *   1) HTTP 请求自动创建 root span（middleware）
 *   2) Controller 方法自动套一层 span（APP_INTERCEPTOR 全局）
 *   3) Service 里通过 TraceService.startSpan('xxx', {...}) 手动加子 span
 *   4) 查 trace：Admin GET /api/debug/v1/traces/recent
 *
 * 关闭追踪：环境变量 TRACE_ENABLED=false
 */
@Module({
  providers: [
    { provide: TraceService, useValue: traceService },
    { provide: APP_INTERCEPTOR, useClass: GameTraceInterceptor },
  ],
  controllers: [TraceController],
  exports: [TraceService],
})
export class TraceModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes('*');
  }
}
