import { Injectable } from '@nestjs/common';
import { SichuanMahjongTableService } from './sichuanmajiang-table.service';
import { SichuanMahjongMode } from '@constants/enums';
import { GameView, ActionDto } from './sichuanmajiang.types';

@Injectable()
export class SichuanMahjongService {
  constructor(private readonly table: SichuanMahjongTableService) {}

  async create(
    hostPlayerId: string,
    mode: SichuanMahjongMode,
    socketId?: string,
  ): Promise<{ tableId: string; seat: number; view: GameView }> {
    return this.table.createTable(hostPlayerId, mode, socketId);
  }

  async join(tableId: string, playerId: string, socketId?: string) {
    return this.table.joinTable(tableId, playerId, socketId);
  }

  /** 房主开局（未满 4 人时 AI 补位） */
  async start(tableId: string, playerId: string): Promise<{ view: GameView }> {
    return this.table.startTable(tableId, playerId);
  }

  async action(tableId: string, playerId: string, dto: ActionDto): Promise<GameView> {
    return this.table.applyAction(tableId, playerId, dto);
  }

  async view(tableId: string, playerId: string): Promise<GameView> {
    return this.table.getView(tableId, playerId);
  }

  async viewBySeat(tableId: string, seat: number): Promise<GameView> {
    return this.table.viewBySeat(tableId, seat);
  }

  /** 需要推送的真人座位（用于给每人下发各自视角的牌桌） */
  async broadcastTargets(tableId: string) {
    return this.table.broadcastTargets(tableId);
  }

  async history(playerId: string, limit?: number) {
    return this.table.history(playerId, limit);
  }

  async leave(tableId: string, playerId: string) {
    return this.table.leaveTable(tableId, playerId);
  }
}
