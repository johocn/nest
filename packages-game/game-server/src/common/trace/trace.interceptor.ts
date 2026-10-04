import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError, finalize } from 'rxjs/operators';
import { TraceService } from './trace.service';

/**
 * NestJS 拦截器 —— 每个 Controller 方法自动包一层 span。
 * 挂载到 Controller 类或方法上：@UseInterceptors(GameTraceInterceptor)
 * 或全局：app.useGlobalInterceptors(new GameTraceInterceptor(traceService))
 */
@Injectable()
export class GameTraceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(GameTraceInterceptor.name);

  constructor(private readonly traceService: TraceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.traceService.enabled) return next.handle();

    const cls = context.getClass()?.name ?? '?';
    const method = context.getHandler()?.name ?? '?';
    const span = this.traceService.startSpan(`${cls}.${method}`);

    // 尝试拿到一些上下文属性
    const args = context.getArgs();
    if (args?.[1]?.body) {
      // 取少量 body 字段作为 attributes（不写敏感信息）
      const safeBody: Record<string, any> = {};
      for (const [k, v] of Object.entries(args[1].body)) {
        if (typeof v !== 'object' || v === null) safeBody[k] = v;
      }
      span.setAttribute('body.keys', Object.keys(args[1].body).join(','));
    }

    return next.handle().pipe(
      catchError((err) => {
        span.recordError(err);
        throw err;
      }),
      finalize(() => {
        this.traceService.endSpan(span);
      }),
    );
  }
}
