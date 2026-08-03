import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServerStatus } from './entities';
import { ConnectionService } from '@modules/gateway/connection.service';
import { ServerState } from '@constants/enums';

export interface OnlineStats {
  currentOnline: number;
  maxOnline: number;
}

@Injectable()
export class ServerStatusService {
  constructor(
    @InjectRepository(ServerStatus)
    private readonly statusRepo: Repository<ServerStatus>,
    private readonly connectionService: ConnectionService,
  ) {}

  async getServerStatus(): Promise<ServerStatus | null> {
    return this.statusRepo.findOne({ where: { serverName: 'main' } });
  }

  async setMaintenance(
    enabled: boolean,
    message?: string,
  ): Promise<ServerStatus> {
    let status = await this.statusRepo.findOne({
      where: { serverName: 'main' },
    });
    if (!status) {
      status = this.statusRepo.create({
        serverName: 'main',
        state: ServerState.RUNNING,
      });
    }

    status.state = enabled ? ServerState.MAINTENANCE : ServerState.RUNNING;
    status.maintenanceMessage = enabled ? (message ?? null) : null;
    return this.statusRepo.save(status);
  }

  async getOnlineStats(): Promise<OnlineStats> {
    const onlinePlayers = await this.connectionService.getOnlinePlayers();
    const currentOnline = onlinePlayers.length;

    let status = await this.statusRepo.findOne({
      where: { serverName: 'main' },
    });
    if (!status) {
      status = this.statusRepo.create({
        serverName: 'main',
        state: ServerState.RUNNING,
      });
    }

    if (currentOnline > status.maxOnline) {
      status.maxOnline = currentOnline;
    }
    status.currentOnline = currentOnline;
    await this.statusRepo.save(status);

    return { currentOnline, maxOnline: status.maxOnline };
  }
}
