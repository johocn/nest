import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppsAdminService } from './apps-admin.service';
import { App } from './entities/app.entity';
import { ErrorCodes } from '@constants/error-codes';

describe('AppsAdminService', () => {
  let service: AppsAdminService;
  let appRepo: jest.Mocked<Repository<App>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppsAdminService,
        {
          provide: getRepositoryToken(App),
          useValue: {
            findOne: jest.fn(),
            findAndCount: jest.fn().mockResolvedValue([[], 0]),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            save: jest.fn(async (data: any) => data),
          },
        },
      ],
    }).compile();

    service = module.get(AppsAdminService);
    appRepo = module.get(getRepositoryToken(App));
  });

  describe('create', () => {
    it('生成 64 位 hex apiKey，isActive 默认 true，响应不回显 apiKey', async () => {
      appRepo.findOne.mockResolvedValue(null);

      const created = await service.create({ code: 'gameB', name: '游戏B' });

      const arg = appRepo.create.mock.calls[0][0] as any;
      expect(arg.code).toBe('gameB');
      expect(arg.name).toBe('游戏B');
      expect(arg.apiKey).toMatch(/^[0-9a-f]{64}$/);
      expect(arg.isActive).toBe(true);
      expect(created).not.toHaveProperty('apiKey');
    });

    it('code 冲突（含软删行）抛 APP_CODE_EXISTS 且不落库', async () => {
      appRepo.findOne.mockResolvedValue({ id: '1', code: 'gameB', deletedAt: new Date() } as App);

      await expect(
        service.create({ code: 'gameB', name: 'x' }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.APP_CODE_EXISTS } });
      expect(appRepo.findOne).toHaveBeenCalledWith({
        where: { code: 'gameB' },
        withDeleted: true,
      });
      expect(appRepo.save).not.toHaveBeenCalled();
    });

    it('缺 code/name 抛 PARAM_INVALID', async () => {
      await expect(service.create({ code: 'gameB' })).rejects.toMatchObject({
        response: { code: ErrorCodes.PARAM_INVALID },
      });
      await expect(service.create({ name: 'x' })).rejects.toMatchObject({
        response: { code: ErrorCodes.PARAM_INVALID },
      });
      expect(appRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('不存在抛 APP_NOT_FOUND', async () => {
      appRepo.findOne.mockResolvedValue(null);

      await expect(service.update('99', { name: 'x' })).rejects.toMatchObject({
        response: { code: ErrorCodes.APP_NOT_FOUND },
      });
    });

    it('仅 name/isActive 可改，code/apiKey 不受 body 影响，响应不回显 apiKey', async () => {
      appRepo.findOne.mockResolvedValue({
        id: '1',
        code: 'gameB',
        name: '旧名',
        apiKey: 'old-key',
        isActive: true,
      } as App);

      const updated = await service.update('1', {
        name: '新名',
        isActive: false,
        code: 'hacked',
        apiKey: 'hacked',
      });

      const saved = appRepo.save.mock.calls[0][0] as any;
      expect(saved.name).toBe('新名');
      expect(saved.isActive).toBe(false);
      expect(saved.code).toBe('gameB');
      expect(saved.apiKey).toBe('old-key');
      expect(updated).not.toHaveProperty('apiKey');
    });
  });

  describe('rotateKey', () => {
    it('重新生成 apiKey 并返回新值', async () => {
      appRepo.findOne.mockResolvedValue({
        id: '1',
        code: 'gameB',
        apiKey: 'old-key',
        isActive: true,
      } as App);

      const result = await service.rotateKey('1');

      expect(result.apiKey).toMatch(/^[0-9a-f]{64}$/);
      expect(result.apiKey).not.toBe('old-key');
      expect(result.code).toBe('gameB');
    });

    it('不存在抛 APP_NOT_FOUND', async () => {
      appRepo.findOne.mockResolvedValue(null);

      await expect(service.rotateKey('99')).rejects.toMatchObject({
        response: { code: ErrorCodes.APP_NOT_FOUND },
      });
    });
  });
});
