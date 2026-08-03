import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  /** 时间窗口秒数 */
  windowSeconds: number;
  /** 窗口内最大请求数 */
  maxRequests: number;
}

export function RateLimit(options: RateLimitOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    SetMetadata(RATE_LIMIT_KEY, options)(target, propertyKey, descriptor);
  };
}
