import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { App } from './entities/app.entity';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { DEFAULT_APP_CODE } from '@shared/content-scope';

@Injectable()
export class AppsService {
  constructor(@InjectRepository(App) private readonly appRepo: Repository<App>) {}

  /** 凭证 → app；无效/停用/空凭证返回 null（表极小，不加缓存） */
  async findByApiKey(apiKey: string): Promise<App | null> {
    if (!apiKey || apiKey.trim() === '') return null;
    return this.appRepo.findOne({ where: { apiKey: apiKey.trim(), isActive: true } });
  }

  /**
   * appCode 解析唯一出口（spec §4.3：不信任前端）：
   * - 无凭证 → DEFAULT_APP_CODE（主游戏，服务端常量）
   * - 凭证有效 → 对应 app.code
   * - 凭证无效 → APP_API_KEY_INVALID
   */
  async resolveAppCode(headerValue: string | undefined | null): Promise<string> {
    if (headerValue === undefined || headerValue === null || headerValue.trim() === '') {
      return DEFAULT_APP_CODE;
    }
    const app = await this.findByApiKey(headerValue);
    if (!app) {
      throw new GameException(ErrorCodes.APP_API_KEY_INVALID, '接入凭证无效');
    }
    return app.code;
  }
}
