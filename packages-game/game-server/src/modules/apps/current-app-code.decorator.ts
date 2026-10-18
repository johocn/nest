import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentAppCode = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.appCode as string;
  },
);
