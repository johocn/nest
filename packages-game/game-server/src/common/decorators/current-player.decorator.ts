import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentPlayerData {
  accountId: string;
  playerId: string;
  tokenVersion: number;
}

export const CurrentPlayer = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentPlayerData => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
