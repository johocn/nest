import { Injectable } from '@nestjs/common';
import { GuandanTableService } from './guandan-table.service';
import { GuandanMode } from '@constants/enums';
import { ActionDto, GameView } from './guandan.types';

@Injectable()
export class GuandanService {
  constructor(private readonly table: GuandanTableService) {}

  create(hostPlayerId: string, mode: GuandanMode, socketId?: string) {
    return this.table.createTable(hostPlayerId, mode, socketId);
  }

  join(tableId: string, playerId: string, socketId?: string) {
    return this.table.joinTable(tableId, playerId, socketId);
  }

  start(tableId: string, playerId: string) {
    return this.table.startTable(tableId, playerId);
  }

  action(tableId: string, playerId: string, dto: ActionDto) {
    return this.table.applyAction(tableId, playerId, dto);
  }

  view(tableId: string, playerId: string): Promise<GameView> {
    return this.table.getView(tableId, playerId);
  }

  viewBySeat(tableId: string, seat: number): Promise<GameView> {
    return this.table.viewBySeat(tableId, seat);
  }

  broadcastTargets(tableId: string) {
    return this.table.broadcastTargets(tableId);
  }

  history(playerId: string, limit?: number) {
    return this.table.history(playerId, limit);
  }

  leave(tableId: string, playerId: string) {
    return this.table.leaveTable(tableId, playerId);
  }
}
