import { Injectable } from '@nestjs/common';
import { SanguoshaTableService } from './sanguosha-table.service';
import { SanguoshaMode } from '@constants/enums';
import { ActionDto, ClientGameView } from './sanguosha.types';

/** 业务编排：直接转发到房间调度层（房间级隔离的全部逻辑在 table service）。 */
@Injectable()
export class SanguoshaService {
  constructor(private readonly table: SanguoshaTableService) {}

  create(
    hostPlayerId: string,
    mode: SanguoshaMode,
    tenantId: string,
    socketId?: string,
  ) {
    return this.table.createTable(hostPlayerId, mode, tenantId, socketId);
  }

  join(tableId: string, playerId: string, tenantId: string, socketId?: string) {
    return this.table.joinTable(tableId, playerId, tenantId, socketId);
  }

  start(tableId: string, playerId: string, tenantId: string) {
    return this.table.startTable(tableId, playerId, tenantId);
  }

  action(tableId: string, playerId: string, tenantId: string, dto: ActionDto) {
    return this.table.applyAction(tableId, playerId, tenantId, dto);
  }

  view(
    tableId: string,
    playerId: string,
    tenantId: string,
  ): Promise<ClientGameView> {
    return this.table.getView(tableId, playerId, tenantId);
  }

  viewBySeat(tableId: string, seat: number): Promise<ClientGameView> {
    return this.table.viewBySeat(tableId, seat);
  }

  broadcastTargets(tableId: string) {
    return this.table.broadcastTargets(tableId);
  }

  history(playerId: string, tenantId: string, limit?: number) {
    return this.table.history(playerId, tenantId, limit);
  }

  leave(tableId: string, playerId: string, tenantId: string) {
    return this.table.leaveTable(tableId, playerId, tenantId);
  }
}
