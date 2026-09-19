import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommunityService } from './community.service';
import { FeedbackSuggestion, PlayerAmbassador } from './entities';
import { Player } from '@modules/player/entities/player.entity';
import {
  Character,
  TitleTemplate,
  CharacterTitle,
} from '@modules/character/entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { AdminService } from '@modules/admin/admin.service';
import { AnalyticsService } from '@modules/analytics/analytics.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  AmbassadorStatus,
  FeedbackCategory,
  FeedbackStatus,
} from '@constants/enums';
import type { Repository } from 'typeorm';

describe('CommunityService', () => {
  let service: CommunityService;
  let feedbackRepo: jest.Mocked<Repository<FeedbackSuggestion>>;
  let ambassadorRepo: jest.Mocked<Repository<PlayerAmbassador>>;
  let playerRepo: jest.Mocked<Repository<Player>>;
  let charRepo: jest.Mocked<Repository<Character>>;
  let titleRepo: jest.Mocked<Repository<TitleTemplate>>;
  let charTitleRepo: jest.Mocked<Repository<CharacterTitle>>;
  let adminService: jest.Mocked<AdminService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityService,
        {
          provide: getRepositoryToken(FeedbackSuggestion),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: getRepositoryToken(PlayerAmbassador),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: getRepositoryToken(Player),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Character),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TitleTemplate),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CharacterTitle),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: AdminService,
          useValue: { logOperation: jest.fn() },
        },
        {
          provide: AnalyticsService,
          useValue: { getSocialHubs: jest.fn() },
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(CommunityService);
    feedbackRepo = module.get(getRepositoryToken(FeedbackSuggestion));
    ambassadorRepo = module.get(getRepositoryToken(PlayerAmbassador));
    playerRepo = module.get(getRepositoryToken(Player));
    charRepo = module.get(getRepositoryToken(Character));
    titleRepo = module.get(getRepositoryToken(TitleTemplate));
    charTitleRepo = module.get(getRepositoryToken(CharacterTitle));
    adminService = module.get(AdminService);
    eventBus = module.get(EventBusService);
  });

  describe('submitFeedback', () => {
    it('应创建 pending 反馈并发事件', async () => {
      const result = await service.submitFeedback(
        '2',
        FeedbackCategory.SUGGESTION,
        '希望增加摆摊功能',
      );
      expect(result.status).toBe(FeedbackStatus.PENDING);
      expect(feedbackRepo.save).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.stringContaining('feedback'),
        expect.objectContaining({ playerId: '2' }),
      );
    });

    it('非法分类拒绝', async () => {
      await expect(
        service.submitFeedback('2', 'spam' as any, '内容'),
      ).rejects.toThrow(GameException);
    });
  });

  describe('handleFeedback', () => {
    it('pending 可处理并写回复与审计', async () => {
      feedbackRepo.findOne.mockResolvedValue({
        id: '10',
        playerId: '2',
        status: FeedbackStatus.PENDING,
      } as any);
      const result = await service.handleFeedback(
        '1',
        '10',
        FeedbackStatus.ACCEPTED,
        '已采纳，下版本上线',
      );
      expect(result.status).toBe(FeedbackStatus.ACCEPTED);
      expect(result.reply).toBe('已采纳，下版本上线');
      expect(result.handledAt).toBeInstanceOf(Date);
      expect(adminService.logOperation).toHaveBeenCalled();
    });

    it('已处理反馈拒绝二次处理', async () => {
      feedbackRepo.findOne.mockResolvedValue({
        id: '10',
        status: FeedbackStatus.DONE,
      } as any);
      const err: any = await service
        .handleFeedback('1', '10', FeedbackStatus.ACCEPTED)
        .catch((e) => e);
      expect(err).toBeInstanceOf(GameException);
      expect(err.response.code).toBe(ErrorCodes.FEEDBACK_NOT_FOUND);
    });

    it('反馈不存在拒绝', async () => {
      feedbackRepo.findOne.mockResolvedValue(null);
      const err: any = await service
        .handleFeedback('1', '99', FeedbackStatus.ACCEPTED)
        .catch((e) => e);
      expect(err).toBeInstanceOf(GameException);
      expect(err.response.code).toBe(ErrorCodes.FEEDBACK_NOT_FOUND);
    });
  });

  describe('appointAmbassador', () => {
    it('任命成功：active + 称号发放 + 审计', async () => {
      ambassadorRepo.findOne.mockResolvedValue(null);
      titleRepo.findOne.mockResolvedValue({ id: '5', name: '江湖大使' } as any);
      charRepo.findOne.mockResolvedValue({ id: '7', playerId: '2' } as any);
      charTitleRepo.findOne.mockResolvedValue(null);

      const result = await service.appointAmbassador('1', '2', '社区贡献突出');

      expect(result.status).toBe(AmbassadorStatus.ACTIVE);
      expect(result.remark).toBe('社区贡献突出');
      expect(charTitleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: '7', titleId: '5' }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.stringContaining('ambassador'),
        expect.objectContaining({ playerId: '2' }),
      );
      expect(adminService.logOperation).toHaveBeenCalled();
    });

    it('重复任命在任大使拒绝', async () => {
      ambassadorRepo.findOne.mockResolvedValue({
        id: '3',
        playerId: '2',
        status: AmbassadorStatus.ACTIVE,
      } as any);
      const err: any = await service.appointAmbassador('1', '2').catch((e) => e);
      expect(err).toBeInstanceOf(GameException);
      expect(err.response.code).toBe(ErrorCodes.AMBASSADOR_EXISTS);
    });

    it('称号模板不存在时不阻断任命', async () => {
      ambassadorRepo.findOne.mockResolvedValue(null);
      titleRepo.findOne.mockResolvedValue(null);
      const result = await service.appointAmbassador('1', '2');
      expect(result.status).toBe(AmbassadorStatus.ACTIVE);
      expect(charTitleRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('revokeAmbassador', () => {
    it('撤销成功：revoked + revokedAt', async () => {
      ambassadorRepo.findOne.mockResolvedValue({
        id: '3',
        playerId: '2',
        status: AmbassadorStatus.ACTIVE,
      } as any);
      const result = await service.revokeAmbassador('1', '3');
      expect(result.status).toBe(AmbassadorStatus.REVOKED);
      expect(result.revokedAt).toBeInstanceOf(Date);
      expect(adminService.logOperation).toHaveBeenCalled();
    });

    it('已撤销拒绝重复撤销', async () => {
      ambassadorRepo.findOne.mockResolvedValue({
        id: '3',
        status: AmbassadorStatus.REVOKED,
      } as any);
      const err: any = await service.revokeAmbassador('1', '3').catch((e) => e);
      expect(err).toBeInstanceOf(GameException);
      expect(err.response.code).toBe(ErrorCodes.AMBASSADOR_NOT_FOUND);
    });
  });

  describe('getActiveAmbassadors', () => {
    it('返回在任大使并带昵称', async () => {
      ambassadorRepo.find.mockResolvedValue([
        { id: '3', playerId: '2', status: AmbassadorStatus.ACTIVE } as any,
      ]);
      playerRepo.find.mockResolvedValue([
        { id: '2', nickname: '侠客小赵' } as any,
      ]);
      const result = await service.getActiveAmbassadors();
      expect(result[0].nickname).toBe('侠客小赵');
    });
  });
});
