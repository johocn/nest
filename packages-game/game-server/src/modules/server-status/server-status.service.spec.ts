import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServerStatusService } from './server-status.service';
import { ServerStatus } from './entities';
import { ConnectionService } from '@modules/gateway/connection.service';
import { ServerState } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('ServerStatusService', () => {
  let service: ServerStatusService;
  let statusRepo: jest.Mocked<Repository<ServerStatus>>;
  let connectionService: jest.Mocked<ConnectionService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServerStatusService,
        {
          provide: getRepositoryToken(ServerStatus),
          useValue: {
            findOne: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
          },
        },
        {
          provide: ConnectionService,
          useValue: {
            getOnlinePlayers: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ServerStatusService);
    statusRepo = module.get(getRepositoryToken(ServerStatus));
    connectionService = module.get(ConnectionService);
  });

  describe('getServerStatus', () => {
    it('should return server status', async () => {
      statusRepo.findOne.mockResolvedValue({
        id: '1',
        serverName: 'main',
        state: ServerState.RUNNING,
        maxOnline: 1000,
        currentOnline: 50,
        maintenanceMessage: null,
        version: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ServerStatus);

      const result = await service.getServerStatus();

      expect(result?.state).toBe(ServerState.RUNNING);
    });
  });

  describe('setMaintenance', () => {
    it('should update server state to maintenance', async () => {
      statusRepo.findOne.mockResolvedValue({
        id: '1',
        serverName: 'main',
        state: ServerState.RUNNING,
        maxOnline: 1000,
        currentOnline: 50,
        maintenanceMessage: null,
        version: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ServerStatus);

      const result = await service.setMaintenance(true, '系统维护中');

      expect(result.state).toBe(ServerState.MAINTENANCE);
      expect(result.maintenanceMessage).toBe('系统维护中');
    });
  });

  describe('getOnlineStats', () => {
    it('should return online player count and max online', async () => {
      connectionService.getOnlinePlayers.mockResolvedValue(['p1', 'p2']);
      statusRepo.findOne.mockResolvedValue({
        id: '1',
        serverName: 'main',
        state: ServerState.RUNNING,
        maxOnline: 500,
        currentOnline: 2,
        maintenanceMessage: null,
        version: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ServerStatus);

      const result = await service.getOnlineStats();

      expect(result.currentOnline).toBe(2);
      expect(result.maxOnline).toBe(500);
    });
  });
});
