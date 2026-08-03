import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GmOperateLog } from './entities';
import { ConnectionService } from '@modules/gateway/connection.service';

export interface LogOperationParams {
  adminId: string;
  targetPlayerId?: string;
  operation: string;
  changeBefore?: Record<string, any>;
  changeAfter?: Record<string, any>;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(GmOperateLog)
    private readonly gmLogRepo: Repository<GmOperateLog>,
    private readonly connectionService: ConnectionService,
  ) {}

  async getOnlineCount(): Promise<{ count: number }> {
    const players = await this.connectionService.getOnlinePlayers();
    return { count: players.length };
  }

  async logOperation(params: LogOperationParams): Promise<GmOperateLog> {
    const log = this.gmLogRepo.create({
      adminId: params.adminId,
      targetPlayerId: params.targetPlayerId ?? null,
      operation: params.operation,
      changeBefore: params.changeBefore ?? {},
      changeAfter: params.changeAfter ?? {},
    });
    return this.gmLogRepo.save(log);
  }

  async getGmLogs(
    page: number,
    limit: number,
  ): Promise<{ items: GmOperateLog[]; total: number }> {
    const [items, total] = await this.gmLogRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }
}
