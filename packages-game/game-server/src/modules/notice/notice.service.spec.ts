import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NoticeService } from './notice.service';
import { Notice } from './entities';
import { NoticeType } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('NoticeService', () => {
  let service: NoticeService;
  let noticeRepo: jest.Mocked<Repository<Notice>>;

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
      ],
    }).compile();

    service = module.get(NoticeService);
    noticeRepo = module.get(getRepositoryToken(Notice));
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
});
