import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VipConfig } from './entities/vip-config.entity';
import { PlayerService } from '@modules/player/player.service';
import { EconomyService } from '@modules/economy/economy.service';
import { CacheService } from '@cache/cache.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { CurrencyType } from '@constants/enums';
import { getTodayStr } from '@utils/time.util';

const VIP_DAILY_KEY = (playerId: string) =>
  `vip:daily:${playerId}:${getTodayStr()}`;

@Injectable()
export class VipService {
  constructor(
    @InjectRepository(VipConfig)
    private readonly configRepo: Repository<VipConfig>,
    private readonly playerService: PlayerService,
    private readonly cacheService: CacheService,
    private readonly economyService: EconomyService,
  ) {}

  async addVipExp(playerId: string, exp: number) {
    return this.playerService.addVipExp(playerId, exp);
  }

  async getVipInfo(
    playerId: string,
  ): Promise<{
    vipLevel: number;
    vipExp: number;
    requiredExp: number;
    privilege: Record<string, any>;
  }> {
    const player = await this.playerService.getById(playerId);
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }
    const config = await this.configRepo.findOne({
      where: { level: player.vipLevel },
    });
    return {
      vipLevel: player.vipLevel,
      vipExp: player.vipExp,
      requiredExp: config?.requiredExp ?? player.vipLevel * 1000,
      privilege: config?.privilegeJson ?? {},
    };
  }

  async claimDailyReward(
    playerId: string,
  ): Promise<{ reward: Record<string, any>; delivered: boolean }> {
    const player = await this.playerService.getById(playerId);
    if (!player) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '玩家不存在');
    }

    const claimed = await this.cacheService.get(VIP_DAILY_KEY(playerId));
    if (claimed) {
      throw new GameException(
        ErrorCodes.VIP_DAILY_REWARD_CLAIMED,
        '今日已领取VIP奖励',
      );
    }

    const config = await this.configRepo.findOne({
      where: { level: player.vipLevel },
    });
    const reward = config?.dailyRewardJson ?? {};

    // Deliver rewards BEFORE setting cache flag (prevent reward loss on failure)
    if (reward.gold) {
      await this.economyService.addCurrency(
        playerId,
        CurrencyType.GOLD,
        reward.gold,
        'vip_daily',
        `vip_daily:${getTodayStr()}`,
      );
    }
    if (reward.diamond) {
      await this.economyService.addCurrency(
        playerId,
        CurrencyType.DIAMOND,
        reward.diamond,
        'vip_daily',
        `vip_daily:${getTodayStr()}`,
      );
    }
    if (reward.boundDiamond) {
      await this.economyService.addCurrency(
        playerId,
        CurrencyType.BOUND_DIAMOND,
        reward.boundDiamond,
        'vip_daily',
        `vip_daily:${getTodayStr()}`,
      );
    }

    await this.cacheService.set(VIP_DAILY_KEY(playerId), 'claimed', 86400);

    return { reward, delivered: true };
  }

  async getPrivilege(playerId: string): Promise<Record<string, any>> {
    const player = await this.playerService.getById(playerId);
    if (!player) return {};
    const config = await this.configRepo.findOne({
      where: { level: player.vipLevel },
    });
    return config?.privilegeJson ?? {};
  }

  // ===== Admin CRUD =====

  async getConfigList(): Promise<VipConfig[]> {
    return this.configRepo.find({ order: { level: 'ASC' } });
  }

  async createConfig(data: Partial<VipConfig>): Promise<VipConfig> {
    const config = this.configRepo.create(data);
    return this.configRepo.save(config);
  }

  async updateConfig(
    level: number,
    data: Partial<VipConfig>,
  ): Promise<VipConfig> {
    const config = await this.configRepo.findOne({ where: { level } });
    if (!config) {
      throw new GameException(ErrorCodes.VIP_CONFIG_NOT_FOUND, 'VIP配置不存在');
    }
    Object.assign(config, data);
    return this.configRepo.save(config);
  }

  async deleteConfig(level: number): Promise<{ deleted: boolean }> {
    const result = await this.configRepo.delete({ level });
    return { deleted: (result.affected ?? 0) > 0 };
  }
}
