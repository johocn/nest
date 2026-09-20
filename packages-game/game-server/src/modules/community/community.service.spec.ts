import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommunityService } from './community.service';
import { FeedbackSuggestion, PlayerAmbassador } from './entities';
import { PlayerReport } from '@modules/social/entities/player-report.entity';
import { Player } from '@modules/player/entities/player.entity';
import {
  Character,
  TitleTemplate,
  CharacterTitle,
} from '@modules/character/entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { AdminService } from '@modules/admin/admin.service';
import { AnalyticsService } from '@modules/analytics/analytics.service';
import { AuthService } from '@modules/auth/auth.service';
import { RankingService } from '@modules/ranking/ranking.service';
import { SocialService } from '@modules/social/social.service';
import { EconomyService } from '@modules/economy/economy.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  AmbassadorStatus,
  FeedbackCategory,
  FeedbackStatus,
  PenaltyLevel,
  ReportHandleAction,
  ReportStatus,
  ReportTargetType,
  CurrencyType,
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
  let economyService: jest.Mocked<EconomyService>;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
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
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlayerReport),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
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
            delete: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: AdminService,
          useValue: { logOperation: jest.fn() },
        },
        {
          provide: AuthService,
          useValue: { applyPenalty: jest.fn() },
        },
        {
          provide: AnalyticsService,
          useValue: { getSocialHubs: jest.fn() },
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
        {
          provide: RankingService,
          useValue: { removePlayerFromAll: jest.fn() },
        },
        {
          provide: SocialService,
          useValue: {
            getMyGuildRole: jest.fn(),
            kickGuildMember: jest.fn(),
          },
        },
        {
          provide: EconomyService,
          useValue: { addCurrency: jest.fn() },
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
    economyService = module.get(EconomyService);
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

  describe('举报台账与处置', () => {
    let reportRepo: any;
    let authService: any;
    let socialService: any;
    let rankingService: any;

    beforeEach(() => {
      reportRepo = module.get(getRepositoryToken(PlayerReport));
      authService = module.get(AuthService);
      socialService = module.get(SocialService);
      rankingService = module.get(RankingService);
      jest.clearAllMocks();
    });

    it('台账列表按状态筛选', async () => {
      reportRepo.find.mockResolvedValueOnce([
        { id: '1', status: ReportStatus.PENDING },
      ]);
      reportRepo.count.mockResolvedValueOnce(1);
      const result = await service.listReports(ReportStatus.PENDING, 1, 20);
      expect(result.total).toBe(1);
      expect(reportRepo.find).toHaveBeenCalled();
    });

    it('处理 MUTE 调用 applyPenalty 并标记已处理', async () => {
      reportRepo.findOne.mockResolvedValueOnce({
        id: '1',
        targetType: ReportTargetType.PLAYER,
        targetId: '200',
        status: ReportStatus.PENDING,
      });
      playerRepo.findOne.mockResolvedValueOnce({ id: '200', accountId: '9' });
      authService.applyPenalty.mockResolvedValueOnce({ id: 'p1' });
      adminService.logOperation.mockResolvedValueOnce(undefined);
      reportRepo.update.mockResolvedValueOnce({ affected: 1 });

      await service.handleReport(
        'admin1',
        'adminName',
        '1',
        ReportHandleAction.MUTE,
        '骂人',
        3600,
      );
      expect(authService.applyPenalty).toHaveBeenCalledWith(
        'adminName',
        '200',
        '9',
        PenaltyLevel.MUTE,
        '骂人',
        3600,
      );
      expect(reportRepo.update).toHaveBeenCalledWith(
        { id: '1' },
        expect.objectContaining({
          status: ReportStatus.PROCESSED,
          handleAction: 'MUTE',
        }),
      );
    });

    it('已处理举报拒绝重复处理', async () => {
      reportRepo.findOne.mockResolvedValueOnce({
        id: '1',
        status: ReportStatus.PROCESSED,
      });
      await expect(
        service.handleReport(
          'admin1',
          'adminName',
          '1',
          ReportHandleAction.IGNORE,
          'x',
        ),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.REPORT_ALREADY_HANDLED },
      });
    });

    it('IGNORE 不落惩罚', async () => {
      reportRepo.findOne.mockResolvedValueOnce({
        id: '1',
        targetType: ReportTargetType.PLAYER,
        targetId: '200',
        status: ReportStatus.PENDING,
      });
      reportRepo.update.mockResolvedValueOnce({ affected: 1 });
      await service.handleReport(
        'admin1',
        'adminName',
        '1',
        ReportHandleAction.IGNORE,
        'x',
      );
      expect(authService.applyPenalty).not.toHaveBeenCalled();
    });

    it('BAN 处置联动三项社交后果：称号收回/帮派除名/榜单移除', async () => {
      reportRepo.findOne.mockResolvedValueOnce({
        id: 'r1',
        status: ReportStatus.PENDING,
        targetType: ReportTargetType.PLAYER,
        targetId: '9',
      });
      playerRepo.findOne.mockResolvedValueOnce({ id: '9', accountId: '9' });
      authService.applyPenalty.mockResolvedValueOnce(undefined);
      charRepo.findOne.mockResolvedValueOnce({ id: 'c9', playerId: '9' });
      charTitleRepo.delete.mockResolvedValueOnce({ affected: 2 });
      socialService.getMyGuildRole.mockResolvedValueOnce({ guildId: 'g1' });
      socialService.kickGuildMember.mockResolvedValueOnce({ removed: true });
      rankingService.removePlayerFromAll.mockResolvedValueOnce(['power']);
      adminService.logOperation.mockResolvedValueOnce(undefined);
      reportRepo.update.mockResolvedValueOnce({ affected: 1 });

      await service.handleReport(
        'a1',
        'admin',
        'r1',
        ReportHandleAction.BAN,
        '违规',
        3600,
      );

      expect(authService.applyPenalty).toHaveBeenCalledWith(
        'admin',
        '9',
        '9',
        PenaltyLevel.BAN,
        '违规',
        3600,
      );
      expect(charTitleRepo.delete).toHaveBeenCalledWith({ characterId: 'c9' });
      expect(socialService.kickGuildMember).toHaveBeenCalledWith(
        '0',
        'g1',
        '9',
        '封禁处置',
      );
      expect(rankingService.removePlayerFromAll).toHaveBeenCalledWith('9');
      expect(economyService.addCurrency).toHaveBeenCalledWith(
        '9',
        CurrencyType.INFAMY,
        100,
        'ban_penalty',
        'ban:9',
      );
    });

    it('BAN 处置无称号无帮派时仍执行榜单移除', async () => {
      reportRepo.findOne.mockResolvedValueOnce({
        id: 'r2',
        status: ReportStatus.PENDING,
        targetType: ReportTargetType.PLAYER,
        targetId: '10',
      });
      playerRepo.findOne.mockResolvedValueOnce({ id: '10', accountId: '10' });
      authService.applyPenalty.mockResolvedValueOnce(undefined);
      charRepo.findOne.mockResolvedValueOnce(null);
      socialService.getMyGuildRole.mockResolvedValueOnce(null);
      rankingService.removePlayerFromAll.mockResolvedValueOnce(['power', 'level']);
      reportRepo.update.mockResolvedValueOnce({ affected: 1 });

      await service.handleReport(
        'a1',
        'admin',
        'r2',
        ReportHandleAction.BAN,
        '违规',
        3600,
      );

      expect(charTitleRepo.delete).not.toHaveBeenCalled();
      expect(socialService.kickGuildMember).not.toHaveBeenCalled();
      expect(rankingService.removePlayerFromAll).toHaveBeenCalledWith('10');
    });

    it('socialCleanup 无待清理资产时报已清理且幂等移除榜单', async () => {
      charRepo.findOne.mockResolvedValueOnce(null);
      socialService.getMyGuildRole.mockResolvedValueOnce(null);
      rankingService.removePlayerFromAll.mockResolvedValueOnce(['power']);

      const err: any = await service
        .socialCleanup('a1', '9')
        .catch((e) => e);
      expect(err).toBeInstanceOf(GameException);
      expect(err.response.code).toBe(ErrorCodes.CLEANUP_ALREADY_DONE);
      expect(rankingService.removePlayerFromAll).toHaveBeenCalledWith('9');
    });

    it('socialCleanup 有待清理资产时执行三项联动', async () => {
      charRepo.findOne.mockResolvedValue({ id: 'c9', playerId: '9' });
      charTitleRepo.count.mockResolvedValue(1);
      charTitleRepo.delete.mockResolvedValueOnce({ affected: 1 });
      socialService.getMyGuildRole.mockResolvedValue({ guildId: 'g1' });
      socialService.kickGuildMember.mockResolvedValueOnce({ removed: true });
      rankingService.removePlayerFromAll.mockResolvedValueOnce(['power']);
      adminService.logOperation.mockResolvedValueOnce(undefined);

      const result = await service.socialCleanup('a1', '9');

      expect(result.cleaned).toBe(true);
      expect(charTitleRepo.delete).toHaveBeenCalledWith({ characterId: 'c9' });
      expect(socialService.kickGuildMember).toHaveBeenCalled();
      expect(rankingService.removePlayerFromAll).toHaveBeenCalledWith('9');
    });
  });
});
