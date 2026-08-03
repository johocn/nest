import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminJwtPayload } from '@common/guards/admin.guard';

export const CurrentAdmin = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AdminJwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
