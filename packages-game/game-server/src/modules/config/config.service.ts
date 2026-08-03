import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RemoteConfig } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ConfigType } from '@constants/enums';

const CONFIG_CACHE_PREFIX = 'config:';
const CONFIG_CACHE_TTL = 300; // 5 minutes

@Injectable()
export class ConfigManageService {
  constructor(
    @InjectRepository(RemoteConfig)
    private readonly configRepo: Repository<RemoteConfig>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
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
