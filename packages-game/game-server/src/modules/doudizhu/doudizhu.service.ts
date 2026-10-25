import { Injectable } from '@nestjs/common';
import { DoudizhuTableService } from './doudizhu-table.service';
import { DoudizhuMode } from '@constants/enums';
import { DoudizhuActionDto, DoudizhuView } from './doudizhu.types';
import { AiLevel } from './engine';

/** 斗地主业务编排（薄层，权威逻辑全部下沉到 DoudizhuTableService）。 */
@Injectable()
export class DoudizhuService {
  constructor(private readonly table: DoudizhuTableService) {}

  create(
    hostPlayerId: string,
    mode: DoudizhuMode,
    socketId?: string,
    aiLevel: AiLevel = 'normal',
  ) {
    return this.table.createTable(hostPlayerId, mode, socketId, aiLevel);
  }

  join(tableId: string, playerId: string, socketId?: string) {
    return this.table.joinTable(tableId, playerId, socketId);
  }

  start(tableId: string, playerId: string) {
    return this.table.startTable(tableId, playerId);
  }

  waitForFriends(tableId: string, playerId: string) {
    return this.table.waitForFriends(tableId, playerId);
  }

  action(tableId: string, playerId: string, dto: DoudizhuActionDto) {
    return this.table.applyAction(tableId, playerId, dto);
  }

  view(tableId: string, playerId: string): Promise<DoudizhuView> {
    return this.table.getView(tableId, playerId);
  }

  viewBySeat(tableId: string, seat: number): Promise<DoudizhuView> {
    return this.table.viewBySeat(tableId, seat);
  }

  broadcastTargets(tableId: string) {
    return this.table.broadcastTargets(tableId);
  }

  history(playerId: string, limit?: number) {
    return this.table.history(playerId, limit);
  }

  replay(tableId: string, playerId: string) {
    return this.table.replay(tableId, playerId);
  }

  leave(tableId: string, playerId: string) {
    return this.table.leaveTable(tableId, playerId);
  }

  host(tableId: string, playerId: string, on: boolean) {
    return this.table.setHost(tableId, playerId, on);
  }

  disconnect(socketId: string) {
    return this.table.disconnectBySocket(socketId);
  }
}
