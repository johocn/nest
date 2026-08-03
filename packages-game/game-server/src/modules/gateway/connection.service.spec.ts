import { Test, TestingModule } from '@nestjs/testing';
import { ConnectionService } from './connection.service';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';

describe('ConnectionService', () => {
  let service: ConnectionService;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionService,
        {
          provide: CacheService,
          useValue: {
            sAdd: jest.fn(),
            sRem: jest.fn(),
            sMembers: jest.fn(),
            hSet: jest.fn(),
            hGet: jest.fn(),
            hGetAll: jest.fn(),
            del: jest.fn(),
            exists: jest.fn(),
            expire: jest.fn().mockResolvedValue(true),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(ConnectionService);
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  describe('playerConnect', () => {
    it('should add player to online set and store connection info', async () => {
      cacheService.exists.mockResolvedValue(false);
      await service.playerConnect('p1', 'socket1', '192.168.1.1', 'device1');
      expect(cacheService.sAdd).toHaveBeenCalledWith('online:players', 'p1');
      expect(cacheService.hSet).toHaveBeenCalledWith(
        'online:player:p1',
        'socketId',
        'socket1',
      );
      expect(cacheService.hSet).toHaveBeenCalledWith(
        'online:socket:socket1',
        'playerId',
        'p1',
      );
      expect(eventBus.emit).toHaveBeenCalledWith('gateway.player.online', {
        playerId: 'p1',
        socketId: 'socket1',
      });
    });
  });

  describe('playerDisconnect', () => {
    it('should remove player from online set and delete connection info', async () => {
      cacheService.hGetAll.mockResolvedValue({ socketId: 'socket1' });
      await service.playerDisconnect('p1');
      expect(cacheService.sRem).toHaveBeenCalledWith('online:players', 'p1');
      expect(cacheService.del).toHaveBeenCalledWith('online:player:p1');
      expect(cacheService.del).toHaveBeenCalledWith('online:socket:socket1');
      expect(eventBus.emit).toHaveBeenCalledWith('gateway.player.offline', {
        playerId: 'p1',
        reason: 'disconnect',
      });
    });
  });

  describe('isOnline', () => {
    it('should return true when player is online', async () => {
      cacheService.exists.mockResolvedValue(true);
      const result = await service.isOnline('p1');
      expect(result).toBe(true);
    });

    it('should return false when player is offline', async () => {
      cacheService.exists.mockResolvedValue(false);
      const result = await service.isOnline('p1');
      expect(result).toBe(false);
    });
  });

  describe('getOnlinePlayers', () => {
    it('should return list of online player IDs', async () => {
      cacheService.sMembers.mockResolvedValue(['p1', 'p2', 'p3']);
      const result = await service.getOnlinePlayers();
      expect(result).toEqual(['p1', 'p2', 'p3']);
    });
  });

  describe('getPlayerConnection', () => {
    it('should return connection info hash', async () => {
      cacheService.hGetAll.mockResolvedValue({
        socketId: 'socket1',
        sceneId: '1',
        loginAt: '1234567890',
      });
      const result = await service.getPlayerConnection('p1');
      expect(result.socketId).toBe('socket1');
      expect(result.sceneId).toBe('1');
    });
  });

  describe('updateHeartbeat', () => {
    it('should update lastHeartbeat field', async () => {
      await service.updateHeartbeat('p1');
      expect(cacheService.hSet).toHaveBeenCalledWith(
        'online:player:p1',
        'lastHeartbeat',
        expect.any(String),
      );
    });
  });

  describe('updatePlayerScene', () => {
    it('should update sceneId in connection info', async () => {
      await service.updatePlayerScene('p1', 'scene2');
      expect(cacheService.hSet).toHaveBeenCalledWith(
        'online:player:p1',
        'sceneId',
        'scene2',
      );
    });
  });

  describe('getPlayerBySocket', () => {
    it('should return playerId from socket mapping', async () => {
      cacheService.hGet.mockResolvedValue('p1');
      const result = await service.getPlayerBySocket('socket1');
      expect(result).toBe('p1');
    });

    it('should return null when socket not found', async () => {
      cacheService.hGet.mockResolvedValue(null);
      const result = await service.getPlayerBySocket('unknown');
      expect(result).toBeNull();
    });
  });

  describe('getOnlineCount', () => {
    it('should return count of online players', async () => {
      cacheService.sMembers.mockResolvedValue(['p1', 'p2', 'p3']);

      const result = await service.getOnlineCount();

      expect(result).toBe(3);
    });

    it('should return 0 when no players online', async () => {
      cacheService.sMembers.mockResolvedValue([]);

      const result = await service.getOnlineCount();

      expect(result).toBe(0);
    });
  });
});
