import { Controller, Get, Headers } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GuandanService } from './guandan.service';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';

/** 轻量 REST：对局历史（与网关共享 JWT 鉴权约定） */
@Controller('guandan')
export class GuandanController {
  constructor(
    private readonly guandan: GuandanService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('history')
  async history(@Headers('authorization') auth: string) {
    if (!auth?.startsWith('Bearer ')) {
      throw new GameException(ErrorCodes.TOKEN_INVALID, '未认证');
    }
    let pid: string;
    try {
      pid = this.jwtService.verify(auth.slice(7)).playerId;
    } catch {
      throw new GameException(ErrorCodes.TOKEN_INVALID, '无效 token');
    }
    return this.guandan.history(pid);
  }
}
