import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RemoteConfig, ConfigVersion } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ConfigType } from '@constants/enums';
import { AdminService } from '@modules/admin/admin.service';

const CONFIG_CACHE_PREFIX = 'config:';
const CONFIG_CACHE_TTL = 300; // 5 minutes

@Injectable()
export class ConfigManageService {
  constructor(
    @InjectRepository(RemoteConfig)
    private readonly configRepo: Repository<RemoteConfig>,
    @InjectRepository(ConfigVersion)
    private readonly versionRepo: Repository<ConfigVersion>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
    private readonly adminService: AdminService,
  ) {}

  async getConfig(
    key: string,
  ): Promise<{
    key: string;
    value: string;
    configType: ConfigType;
    version: number;
  }> {
    // Try Redis first
    const cached = await this.cacheService.get(CONFIG_CACHE_PREFIX + key);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fall back to DB
    const config = await this.configRepo.findOne({ where: { configKey: key } });
    if (!config) {
      throw new GameException(
        ErrorCodes.CONFIG_NOT_FOUND,
        `配置项不存在: ${key}`,
      );
    }

    const result = {
      key: config.configKey,
      value: config.value,
      configType: config.configType,
      version: config.version,
    };

    // Cache in Redis
    await this.cacheService.set(
      CONFIG_CACHE_PREFIX + key,
      JSON.stringify(result),
      CONFIG_CACHE_TTL,
    );

    return result;
  }

  async setConfig(
    key: string,
    value: string,
    configType: ConfigType,
    description?: string,
    adminId?: string,
  ): Promise<RemoteConfig> {
    let config = await this.configRepo.findOne({ where: { configKey: key } });

    if (!config) {
      config = this.configRepo.create({
        configKey: key,
        value,
        configType,
        description: description ?? null,
        version: 1,
        isActive: true,
      });
    } else {
      config.value = value;
      config.configType = configType;
      if (description !== undefined) {
        config.description = description;
      }
      config.version += 1;
    }

    const saved = await this.configRepo.save(config);

    await this.versionRepo.save(
      this.versionRepo.create({
        configKey: key,
        version: saved.version,
        value,
        createdBy: adminId ?? null,
      }),
    );

    // Update Redis cache
    const cacheData = JSON.stringify({
      key: saved.configKey,
      value: saved.value,
      configType: saved.configType,
      version: saved.version,
    });
    await this.cacheService.set(
      CONFIG_CACHE_PREFIX + key,
      cacheData,
      CONFIG_CACHE_TTL,
    );

    // Emit config update event for hot reload
    this.eventBus.emit(GameEvents.CONFIG_UPDATED, {
      key,
      value,
      version: saved.version,
    });

    return saved;
  }

  async listConfigVersions(
    key: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: ConfigVersion[]; total: number }> {
    const [items, total] = await this.versionRepo.findAndCount({
      where: { configKey: key },
      skip: (page - 1) * limit,
      take: limit,
      order: { version: 'DESC' },
    });
    return { items, total };
  }

  async rollbackConfig(
    adminId: string,
    key: string,
    version: number,
  ): Promise<RemoteConfig> {
    const target = await this.versionRepo.findOne({
      where: { configKey: key, version },
    });
    if (!target) {
      throw new GameException(
        ErrorCodes.CONFIG_VERSION_NOT_FOUND,
        `配置版本不存在: ${key}@v${version}`,
      );
    }

    const config = await this.configRepo.findOne({ where: { configKey: key } });
    if (!config) {
      throw new GameException(ErrorCodes.CONFIG_NOT_FOUND, `配置项不存在: ${key}`);
    }
    if (version >= config.version) {
      throw new GameException(
        ErrorCodes.CONFIG_ROLLBACK_FAILED,
        '只能回滚到更早版本',
      );
    }

    const before = { key: config.configKey, value: config.value, version: config.version };
    config.value = target.value;
    config.version += 1;
    const saved = await this.configRepo.save(config);

    await this.versionRepo.save(
      this.versionRepo.create({
        configKey: key,
        version: saved.version,
        value: saved.value,
        createdBy: adminId,
      }),
    );

    await this.cacheService.set(
      CONFIG_CACHE_PREFIX + key,
      JSON.stringify({
        key: saved.configKey,
        value: saved.value,
        configType: saved.configType,
        version: saved.version,
      }),
      CONFIG_CACHE_TTL,
    );

    this.eventBus.emit(GameEvents.CONFIG_UPDATED, {
      key,
      value: saved.value,
      version: saved.version,
    });

    await this.adminService.logOperation({
      adminId,
      operation: 'config.rollback',
      changeBefore: before,
      changeAfter: { key: saved.configKey, value: saved.value, version: saved.version },
    });

    return saved;
  }

  async getTypedValue<T>(key: string): Promise<T> {
    const config = await this.getConfig(key);

    switch (config.configType) {
      case ConfigType.NUMBER:
        return Number(config.value) as unknown as T;
      case ConfigType.BOOLEAN:
        return (config.value === 'true') as unknown as T;
      case ConfigType.JSON:
        return JSON.parse(config.value) as T;
      default:
        return config.value as unknown as T;
    }
  }

  async getConfigList(
    page: number,
    limit: number,
  ): Promise<{ items: RemoteConfig[]; total: number }> {
    const [items, total] = await this.configRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { configKey: 'ASC' },
    });
    return { items, total };
  }

  async deleteConfig(key: string): Promise<void> {
    const config = await this.configRepo.findOne({ where: { configKey: key } });
    if (config) {
      await this.configRepo.remove(config);
    }
    await this.cacheService.del(CONFIG_CACHE_PREFIX + key);
  }
}
