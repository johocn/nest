import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppsService } from './apps.service';
import { App } from './entities/app.entity';
import { ErrorCodes } from '@constants/error-codes';
import { DEFAULT_APP_CODE } from '@shared/content-scope';

describe('AppsService', () => {
  let service: AppsService;
  let appRepo: jest.Mocked<Repository<App>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppsService,
        {
          provide: getRepositoryToken(App),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(AppsService);
    appRepo = module.get(getRepositoryToken(App));
  });

  describe('findByApiKey', () => {
    it('空凭证短路返回 null 且不查库', async () => {
      await expect(service.findByApiKey('')).resolves.toBeNull();
      await expect(service.findByApiKey('   ')).resolves.toBeNull();
      await expect(service.findByApiKey(null as any)).resolves.toBeNull();
      expect(appRepo.findOne).not.toHaveBeenCalled();
    });

    it('有效凭证按 trim + isActive 查询', async () => {
      const app = { id: '1', code: 'gameB' } as App;
      appRepo.findOne.mockResolvedValue(app);

      await expect(service.findByApiKey(' key ')).resolves.toBe(app);
      expect(appRepo.findOne).toHaveBeenCalledWith({
        where: { apiKey: 'key', isActive: true },
      });
    });
  });

  describe('resolveAppCode', () => {
    it('无/空凭证返回 DEFAULT_APP_CODE 且不查库', async () => {
      await expect(service.resolveAppCode(undefined)).resolves.toBe(DEFAULT_APP_CODE);
      await expect(service.resolveAppCode(null)).resolves.toBe(DEFAULT_APP_CODE);
      await expect(service.resolveAppCode('   ')).resolves.toBe(DEFAULT_APP_CODE);
      expect(appRepo.findOne).not.toHaveBeenCalled();
    });

    it('有效凭证返回对应 app.code', async () => {
      appRepo.findOne.mockResolvedValue({ id: '1', code: 'gameB' } as App);

      await expect(service.resolveAppCode('valid-key')).resolves.toBe('gameB');
    });

    it('无效凭证抛 APP_API_KEY_INVALID', async () => {
      appRepo.findOne.mockResolvedValue(null);

      await expect(service.resolveAppCode('bad-key')).rejects.toMatchObject({
        response: { code: ErrorCodes.APP_API_KEY_INVALID },
      });
    });
  });
});
