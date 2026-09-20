import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NoticeService } from './notice.service';
import { Notice, NoticeReaction } from './entities';
import { NoticeReactionType, NoticeType } from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { EventBusService } from '@event-bus/event-bus.service';
import type { Repository } from 'typeorm';

describe('NoticeService', () => {
  let service: NoticeService;
  let noticeRepo: jest.Mocked<Repository<Notice>>;
  let reactionRepo: jest.Mocked<Repository<NoticeReaction>>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoticeService,
        {
          provide: getRepositoryToken(Notice),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(NoticeReaction),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: EventBusService,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(NoticeService);
    noticeRepo = module.get(getRepositoryToken(Notice));
    reactionRepo = module.get(getRepositoryToken(NoticeReaction));
    eventBus = module.get(EventBusService);
  });

  const makeNotice = (overrides: Partial<Notice> = {}): Notice =>
    ({
      id: '1',
      title: '系统维护公告',
      content: '今晚10点维护',
      noticeType: NoticeType.POPUP,
      isActive: true,
      sortOrder: 0,
      startAt: null,
      endAt: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as Notice;

  describe('getActiveNotices', () => {
    it('should return active notices', async () => {
      noticeRepo.find.mockResolvedValue([makeNotice()]);

      const result = await service.getActiveNotices();

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('系统维护公告');
    });

    it('should return empty array when no active notices', async () => {
      noticeRepo.find.mockResolvedValue([]);

      const result = await service.getActiveNotices();

      expect(result).toEqual([]);
    });
  });

  describe('getNoticesByType', () => {
    it('should return notices filtered by type', async () => {
      noticeRepo.find.mockResolvedValue([
        makeNotice({ noticeType: NoticeType.BANNER }),
      ]);

      const result = await service.getNoticesByType(NoticeType.BANNER);

      expect(result).toHaveLength(1);
      expect(result[0].noticeType).toBe(NoticeType.BANNER);
    });
  });

  describe('时间窗过滤（start_at / end_at）', () => {
    it('getActiveNotices 按四个时间窗分支过滤且都要求 isActive', async () => {
      noticeRepo.find.mockResolvedValue([]);

      await service.getActiveNotices();

      const where = noticeRepo.find.mock.calls[0][0].where as any[];
      expect(Array.isArray(where)).toBe(true);
      expect(where).toHaveLength(4);
      expect(where.every((w) => w.isActive === true)).toBe(true);
      expect(where.every((w) => 'startAt' in w && 'endAt' in w)).toBe(true);
    });

    it('getNoticesByType 同样应用时间窗与类型过滤', async () => {
      noticeRepo.find.mockResolvedValue([]);

      await service.getNoticesByType(NoticeType.LOGIN);

      const where = noticeRepo.find.mock.calls[0][0].where as any[];
      expect(where).toHaveLength(4);
      expect(where.every((w) => w.noticeType === NoticeType.LOGIN)).toBe(true);
      expect(where.every((w) => w.isActive === true)).toBe(true);
      expect(where.every((w) => 'startAt' in w && 'endAt' in w)).toBe(true);
    });
  });

  describe('getLoginNotices', () => {
    it('should return login notices', async () => {
      noticeRepo.find.mockResolvedValue([
        makeNotice({ noticeType: NoticeType.LOGIN }),
      ]);

      const result = await service.getLoginNotices();

      expect(result).toHaveLength(1);
    });
  });

  describe('createNotice', () => {
    it('should create and return notice', async () => {
      const result = await service.createNotice({
        title: '新公告',
        content: '测试内容',
        noticeType: NoticeType.POPUP,
      });

      expect(result.title).toBe('新公告');
    });
  });

  describe('updateNotice', () => {
    it('should update existing notice', async () => {
      noticeRepo.findOne.mockResolvedValue(makeNotice());

      const result = await service.updateNotice('1', { title: '修改标题' });

      expect(result?.title).toBe('修改标题');
    });

    it('should return null when notice not found', async () => {
      noticeRepo.findOne.mockResolvedValue(null);

      const result = await service.updateNotice('999', { title: '不存在' });

      expect(result).toBeNull();
    });
  });

  describe('getNoticeList (admin)', () => {
    it('should return paginated notices', async () => {
      noticeRepo.findAndCount.mockResolvedValue([[makeNotice()], 1]);

      const result = await service.getNoticeList(1, 20);

      expect(result.items).toHaveLength(1);
    });
  });

  describe('react', () => {
    it('点赞计数递增并发事件', async () => {
      noticeRepo.findOne.mockResolvedValue(
        makeNotice({ likeCount: 0, ackCount: 0 }),
      );
      reactionRepo.findOne.mockResolvedValue(null);

      const result = await service.react('1', '2', NoticeReactionType.LIKE);

      expect(result.likes).toBe(1);
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.stringContaining('notice'),
        expect.objectContaining({ noticeId: '1' }),
      );
    });

    it('重复互动拒绝', async () => {
      noticeRepo.findOne.mockResolvedValue(makeNotice());
      reactionRepo.findOne.mockResolvedValue({ id: '9' } as any);

      const err: any = await service
        .react('1', '2', NoticeReactionType.ACK)
        .catch((e) => e);
      expect(err).toBeInstanceOf(GameException);
      expect(err.response.code).toBe(ErrorCodes.NOTICE_REACTION_EXISTS);
    });

    it('公告不存在拒绝', async () => {
      noticeRepo.findOne.mockResolvedValue(null);

      const err: any = await service
        .react('99', '2', NoticeReactionType.LIKE)
        .catch((e) => e);
      expect(err).toBeInstanceOf(GameException);
      expect(err.response.code).toBe(ErrorCodes.NOTICE_REACTION_EXISTS);
    });
  });

  describe('getReactions', () => {
    it('返回互动计数', async () => {
      noticeRepo.findOne.mockResolvedValue(
        makeNotice({ likeCount: 3, ackCount: 1 }),
      );

      const result = await service.getReactions('1');

      expect(result).toEqual({ noticeId: '1', likes: 3, acks: 1 });
    });
  });
});
