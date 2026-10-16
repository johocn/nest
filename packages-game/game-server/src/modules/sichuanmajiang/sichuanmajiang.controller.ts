import { Controller, Post, Get, Body, Query, Param } from '@nestjs/common';
import { SichuanMahjongService } from './sichuanmajiang.service';
import { SichuanMahjongMode } from '@constants/enums';
import type { ActionDto } from './sichuanmajiang.types';

/**
 * REST 契约与既有前端保持一致：
 *  POST /api/room?seat=0        { mode }                -> { roomId, view }
 *  GET  /api/room/:id?seat=0                           -> view
 *  POST /api/room/:id/action?seat=0 { type, tile?, suit? } -> view
 */
@Controller('api')
export class SichuanMahjongController {
  constructor(private readonly sichuanmajiang: SichuanMahjongService) {}

  @Post('room')
  async createRoom(
    @Query('seat') seat: string,
    @Body() body: { mode?: string; playerId?: string },
  ) {
    const pid = body.playerId || `guest-${seat || 0}`;
    const mode = body.mode === 'net' ? SichuanMahjongMode.NET : SichuanMahjongMode.AI;
    const r = await this.sichuanmajiang.create(pid, mode);
    return { roomId: r.tableId, seat: r.seat, view: r.view };
  }

  /** 房主开局：未坐满时用 AI 补位 */
  @Post('room/:id/start')
  async startRoom(
    @Param('id') id: string,
    @Query('seat') seat: string,
    @Body() body?: { playerId?: string },
  ) {
    const pid = body?.playerId || `guest-${seat || 0}`;
    return this.sichuanmajiang.start(id, pid);
  }

  @Get('room/:id')
  async getRoom(
    @Param('id') id: string,
    @Query('seat') seat: string,
    @Query('playerId') playerId?: string,
  ) {
    const pid = playerId || `guest-${seat || 0}`;
    return this.sichuanmajiang.view(id, pid);
  }

  /** 我的历史战绩 */
  @Get('history')
  async history(@Query('playerId') playerId: string) {
    if (!playerId) return [];
    return this.sichuanmajiang.history(playerId);
  }

  @Post('room/:id/action')
  async action(
    @Param('id') id: string,
    @Query('seat') seat: string,
    @Body() body: ActionDto,
    @Query('playerId') playerId?: string,
  ) {
    const pid = playerId || `guest-${seat || 0}`;
    return this.sichuanmajiang.action(id, pid, body);
  }
}
