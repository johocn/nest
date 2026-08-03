import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { GmOperateLog } from './entities';
import { ConnectionService } from '@modules/gateway/connection.service';
import type { Repository } from 'typeorm';

describe('AdminService', () => {
  let service: AdminService;
  let gmLogRepo: jest.Mocked<Repository<GmOperateLog>>;
  let connectionService: jest.Mocked<ConnectionService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: getRepositoryToken(GmOperateLog),
          useValue: {
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
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

    service = module.get(AdminService);
    gmLogRepo = module.get(getRepositoryToken(GmOperateLog));
    connectionService = module.get(ConnectionService);
  });

  describe('getOnlineCount', () => {
    it('should return count of online players', async () => {
      connectionService.getOnlinePlayers.mockResolvedValue(['p1', 'p2', 'p3']);

      const result = await service.getOnlineCount();

      expect(result.count).toBe(3);
    });
  });

  describe('logOperation', () => {
    it('should save GM operation log', async () => {
      const result = await service.logOperation({
        adminId: 'admin1',
        targetPlayerId: 'p1',
        operation: 'ban_player',
        changeBefore: { status: 'active' },
        changeAfter: { status: 'banned' },
      });

      expect(result.id).toBe('1');
      expect(gmLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin1',
          operation: 'ban_player',
        }),
      );
    });
  });

  describe('getGmLogs', () => {
    it('should return paginated GM logs', async () => {
      gmLogRepo.findAndCount.mockResolvedValue([[{ id: '1' } as any], 1]);

      const result = await service.getGmLogs(1, 20);

      expect(result.items).toHaveLength(1);
    });
  });
});
