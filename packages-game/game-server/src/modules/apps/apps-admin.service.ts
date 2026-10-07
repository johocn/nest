import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { App } from './entities/app.entity';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/** apps admin CRUD（凭证发放）：响应不回显 apiKey，rotate-key 除外 */
@Injectable()
export class AppsAdminService {
  constructor(@InjectRepository(App) private readonly appRepo: Repository<App>) {}

  async list(
    page: number,
    limit: number,
  ): Promise<{ items: Array<Omit<App, 'apiKey'>>; total: number }> {
    const [items, total] = await this.appRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items: items.map((app) => this.omitApiKey(app)), total };
  }

  async get(id: string): Promise<Omit<App, 'apiKey'>> {
    const app = await this.appRepo.findOne({ where: { id } });
    if (!app) {
      throw new GameException(ErrorCodes.APP_NOT_FOUND, 'app 不存在');
    }
    return this.omitApiKey(app);
  }

  async create(body: any): Promise<Omit<App, 'apiKey'>> {
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!code || !name) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const exists = await this.appRepo.findOne({ where: { code }, withDeleted: true });
    if (exists) {
      throw new GameException(ErrorCodes.APP_CODE_EXISTS, 'app code 已存在');
    }
    const app = await this.appRepo.save(
      this.appRepo.create({
        code,
        name,
        apiKey: randomBytes(32).toString('hex'),
        isActive: body.isActive === undefined ? true : !!body.isActive,
      } as Partial<App>),
    );
    return this.omitApiKey(app);
  }

  async update(id: string, body: any): Promise<Omit<App, 'apiKey'>> {
    const app = await this.appRepo.findOne({ where: { id } });
    if (!app) {
      throw new GameException(ErrorCodes.APP_NOT_FOUND, 'app 不存在');
    }
    // 仅 name/isActive 可改（code 是 scope 归属事实源，apiKey 只能 rotate）
    if (typeof body.name === 'string' && body.name.trim() !== '') {
      app.name = body.name.trim();
    }
    if (body.isActive !== undefined) {
      app.isActive = !!body.isActive;
    }
    const saved = await this.appRepo.save(app);
    return this.omitApiKey(saved);
  }

  async rotateKey(id: string): Promise<{ id: string; code: string; apiKey: string }> {
    const app = await this.appRepo.findOne({ where: { id } });
    if (!app) {
      throw new GameException(ErrorCodes.APP_NOT_FOUND, 'app 不存在');
    }
    app.apiKey = randomBytes(32).toString('hex');
    await this.appRepo.save(app);
    return { id: app.id, code: app.code, apiKey: app.apiKey };
  }

  private omitApiKey(app: App): Omit<App, 'apiKey'> {
    const { apiKey, ...rest } = app;
    return rest;
  }
}
