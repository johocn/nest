import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TraceService, genTraceId } from './trace.service';

/**
 * HTTP 全局中间件 —— 每个请求创建 root span + AsyncLocalStorage 上下文。
 * 通过 Module.configure(consumer.apply(TraceMiddleware).forRoutes('*')) 注册。
 */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TraceMiddleware.name);

  constructor(private readonly traceService: TraceService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.traceService.enabled) return next();

    // 从 header 继承上游 traceId（微服务链路场景），否则新建
    const incomingTraceId =
      (req.headers['x-trace-id'] as string)?.trim() || genTraceId();

    const root = this.traceService.startRootSpan(
      `${req.method} ${req.path}`,
      {
        'http.method': req.method,
        'http.path': req.path,
        'http.url': req.originalUrl,
        'http.remote_ip': req.ip,
      },
      incomingTraceId,
    );

    // 响应头回写 traceId（客户端排障用）
    res.setHeader('x-trace-id', incomingTraceId);

    // res.finish 时：写 http.status + end root + endTrace() 入 ring buffer
    const finish = () => {
      if (root.endTime !== null) return;
      root.setAttribute('http.status', res.statusCode);
      this.traceService.endTrace();

      const durMs = Math.round(root.duration);
      if (durMs > 500) {
        this.logger.warn(
          `[TRACE] SLOW ${req.method} ${req.path} → ${durMs}ms (trace=${incomingTraceId})`,
        );
      }
    };
    res.once('finish', finish);
    res.once('close', finish);

    // ALS.run —— 整个请求处理链都在 trace context 里
    this.traceService.runWithContext(root, () => next());
  }
}
