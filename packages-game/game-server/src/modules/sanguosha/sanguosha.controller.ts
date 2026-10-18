import { Controller, Get, Headers } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SanguoshaService } from './sanguosha.service';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';
import { resolveTenantId } from '@modules/tenant';
import type { JwtPayload } from '@modules/auth/auth.service';

/** 轻量 REST：对局历史（与网关共享 JWT 鉴权约定 + 租户解析） */
@Controller('sanguosha')
export class SanguoshaController {
  constructor(
    private readonly sgs: SanguoshaService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('history')
  async history(
    @Headers('authorization') auth: string,
    @Headers('x-tenant-id') tenantHeader: string,
  ) {
    if (!auth?.startsWith('Bearer ')) {
      throw new GameException(ErrorCodes.TOKEN_INVALID, '未认证');
    }
    let pid: string;
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(auth.slice(7));
      pid = payload.playerId;
    } catch {
      throw new GameException(ErrorCodes.TOKEN_INVALID, '无效 token');
    }
    const tenantId = resolveTenantId(
      payload,
      { 'x-tenant-id': tenantHeader },
      null,
    );
    return this.sgs.history(pid, tenantId);
  }
}
