import { Controller, Get, Headers, Query } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DoudizhuService } from './doudizhu.service';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';

/** 轻量 REST：对局历史 / 复盘回放（与网关共享 JWT 鉴权约定） */
@Controller('doudizhu')
export class DoudizhuController {
  constructor(
    private readonly doudizhu: DoudizhuService,
    private readonly jwtService: JwtService,
  ) {}

  private pidOf(auth: string): string {
    if (!auth?.startsWith('Bearer ')) {
      throw new GameException(ErrorCodes.TOKEN_INVALID, '未认证');
    }
    try {
      return this.jwtService.verify(auth.slice(7)).playerId;
    } catch {
      throw new GameException(ErrorCodes.TOKEN_INVALID, '无效 token');
    }
  }

  @Get('history')
  async history(@Headers('authorization') auth: string) {
    return this.doudizhu.history(this.pidOf(auth));
  }

  @Get('replay')
  async replay(
    @Headers('authorization') auth: string,
    @Query('tableId') tableId: string,
  ) {
    if (!tableId) {
      throw new GameException(
        ErrorCodes.DOUDIZHU_TABLE_NOT_FOUND,
        '缺少 tableId',
      );
    }
    return this.doudizhu.replay(tableId, this.pidOf(auth));
  }
}
