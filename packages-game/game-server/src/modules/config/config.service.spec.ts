import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigManageService } from './config.service';
import { RemoteConfig, ConfigVersion } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ConfigType } from '@constants/enums';
import { AdminService } from '@modules/admin/admin.service';
import type { Repository } from 'typeorm';

describe('ConfigManageService', () => {
  let service: ConfigManageService;
  let configRepo: jest.Mocked<Repository<RemoteConfig>>;
  let versionRepo: jest.Mocked<Repository<ConfigVersion>>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;
  let adminService: jest.Mocked<AdminService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigManageService,
        {
          provide: getRepositoryToken(RemoteConfig),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            remove: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(ConfigVersion),
          useValue: {
            findOne: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
        {
          provide: AdminService,
          useValue: {
            logOperation: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ConfigManageService);
    configRepo = module.get(getRepositoryToken(RemoteConfig));
    versionRepo = module.get(getRepositoryToken(ConfigVersion));
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
    adminService = module.get(AdminService);
  });

  describe('getConfig', () => {
    it('should return cached config from Redis when available', async () => {
      cacheService.get.mockResolvedValue(
        JSON.stringify({
          key: 'max_level',
          value: '100',
          configType: ConfigType.NUMBER,
          version: 2,
        }),
      );

      const result = await service.getConfig('max_level');

      expect(result.value).toBe('100');
      expect(configRepo.findOne).not.toHaveBeenCalled();
    });

    it('should fall back to DB and cache when Redis miss', async () => {
      cacheService.get.mockResolvedValue(null);
      configRepo.findOne.mockResolvedValue({
        id: '1',
        configKey: 'max_level',
        value: '100',
        configType: ConfigType.NUMBER,
        version: 1,
        isActive: true,
      } as any);

      const result = await service.getConfig('max_level');

      expect(result.value).toBe('100');
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('should throw when config not found', async () => {
      cacheService.get.mockResolvedValue(null);
      configRepo.findOne.mockResolvedValue(null);

      await expect(service.getConfig('nonexistent')).rejects.toThrow(
        GameException,
      );
    });
  });

  describe('setConfig', () => {
    it('should create new config when not exists', async () => {
      configRepo.findOne.mockResolvedValue(null);

      const result = await service.setConfig(
        'server_name',
        'MyGame',
        ConfigType.STRING,
      );

      expect(result.configKey).toBe('server_name');
      expect(result.value).toBe('MyGame');
      expect(result.version).toBe(1);
      expect(cacheService.set).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('should update existing config and increment version', async () => {
      configRepo.findOne.mockResolvedValue({
        id: '1',
        configKey: 'max_level',
        value: '50',
        version: 1,
      } as any);

      const result = await service.setConfig(
        'max_level',
        '100',
        ConfigType.NUMBER,
      );

      expect(result.value).toBe('100');
      expect(result.version).toBe(2);
    });
  });

  describe('getTypedValue', () => {
    it('should return number for NUMBER type', async () => {
      cacheService.get.mockResolvedValue(
        JSON.stringify({
          value: '42',
          configType: ConfigType.NUMBER,
        }),
      );

      const result = await service.getTypedValue<number>('answer');

      expect(result).toBe(42);
      expect(typeof result).toBe('number');
    });

    it('should return boolean for BOOLEAN type', async () => {
      cacheService.get.mockResolvedValue(
        JSON.stringify({
          value: 'true',
          configType: ConfigType.BOOLEAN,
        }),
      );

      const result = await service.getTypedValue<boolean>('flag');

      expect(result).toBe(true);
    });

    it('should return parsed object for JSON type', async () => {
      cacheService.get.mockResolvedValue(
        JSON.stringify({
          value: '{"a":1}',
          configType: ConfigType.JSON,
        }),
      );

      const result =
        await service.getTypedValue<Record<string, any>>('json_config');

      expect(result).toEqual({ a: 1 });
    });
  });

  describe('getConfigList', () => {
    it('should return paginated configs', async () => {
      configRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getConfigList(1, 20);

      expect(result.total).toBe(0);
    });
  });

  describe('deleteConfig', () => {
    it('should delete config and clear cache', async () => {
      configRepo.findOne.mockResolvedValue({
        id: '1',
        configKey: 'temp',
        version: 1,
      } as any);

      await service.deleteConfig('temp');

      expect(cacheService.del).toHaveBeenCalled();
    });
  });

  describe('rollbackConfig（13.6 配置回滚）', () => {
    it('should restore value from target version and bump version', async () => {
      versionRepo.findOne.mockResolvedValue({
        configKey: 'max_level',
        version: 1,
        value: '50',
      } as any);
      configRepo.findOne.mockResolvedValue({
        id: '1',
        configKey: 'max_level',
        value: '100',
        configType: ConfigType.NUMBER,
        version: 3,
      } as any);

      const result = await service.rollbackConfig('admin1', 'max_level', 1);

      expect(result.value).toBe('50');
      expect(result.version).toBe(4);
      expect(adminService.logOperation).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'config.rollback' }),
      );
    });

    it('should reject rollback to nonexistent version', async () => {
      versionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.rollbackConfig('admin1', 'max_level', 99),
      ).rejects.toThrow(GameException);
    });

    it('should reject rollback to current or newer version', async () => {
      versionRepo.findOne.mockResolvedValue({
        configKey: 'max_level',
        version: 3,
        value: '90',
      } as any);
      configRepo.findOne.mockResolvedValue({
        id: '1',
        configKey: 'max_level',
        value: '100',
        version: 3,
      } as any);

      await expect(
        service.rollbackConfig('admin1', 'max_level', 3),
      ).rejects.toThrow(GameException);
    });
  });
});
