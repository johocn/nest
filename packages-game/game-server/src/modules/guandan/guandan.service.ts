import { Injectable } from '@nestjs/common';
import { GuandanTableService } from './guandan-table.service';
import { GuandanSocialService } from './guandan-social.service';
import { GuandanMode } from '@constants/enums';
import { ActionDto, GameView } from './guandan.types';
import { AiLevel } from './engine';

@Injectable()
export class GuandanService {
  constructor(
    private readonly table: GuandanTableService,
    private readonly social: GuandanSocialService,
  ) {}

  create(
    hostPlayerId: string,
    mode: GuandanMode,
    socketId?: string,
    aiLevel?: AiLevel,
  ) {
    return this.table.createTable(
      hostPlayerId,
      mode,
      socketId,
      {},
      aiLevel ?? 'normal',
    );
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

  replay(tableId: string, playerId: string) {
    return this.table.replay(tableId, playerId);
  }

  friends(playerId: string) {
    return this.social.friends(playerId);
  }

  isFriend(playerId: string, friendId: string) {
    return this.social.isFriend(playerId, friendId);
  }

  nicknameOf(playerId: string) {
    return this.social.nicknameOf(playerId);
  }

  rank(playerId: string, limit?: number) {
    return this.social.rank(playerId, limit);
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
