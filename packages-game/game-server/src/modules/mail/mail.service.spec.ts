import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MailService } from './mail.service';
import { Mail } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { MailSenderType } from '@constants/enums';
import { Player } from '@modules/player/entities/player.entity';
import { InventoryService } from '@modules/inventory/inventory.service';
import { EconomyService } from '@modules/economy/economy.service';
import { ErrorCodes } from '@constants/error-codes';
import type { Repository } from 'typeorm';

describe('MailService', () => {
  let service: MailService;
  let mailRepo: jest.Mocked<Repository<Mail>>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;
  let inventoryService: jest.Mocked<InventoryService>;
  let economyService: jest.Mocked<EconomyService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: getRepositoryToken(Mail),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            create: jest.fn((data: any) => ({ ...data, id: '1' })),
            findAndCount: jest.fn(),
          },
        },
        // MailService index [1] — PlayerRepo（sendBatchWithTarget 使用）
        {
          provide: getRepositoryToken(Player),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest.fn(() => ({
              where: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            })),
          },
        },
        {
          provide: CacheService,
          useValue: {
            sMembers: jest.fn(),
            sAdd: jest.fn(),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        {
          provide: InventoryService,
          useValue: { addItem: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: EconomyService,
          useValue: {
            addCurrency: jest
              .fn()
              .mockResolvedValue({ balanceAfter: '100' }),
          },
        },
      ],
    }).compile();

    service = module.get(MailService);
    mailRepo = module.get(getRepositoryToken(Mail));
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
    inventoryService = module.get(InventoryService);
    economyService = module.get(EconomyService);
  });

  const makeMail = (overrides: Partial<Mail> = {}): Mail =>
    ({
      id: '1',
      recipientId: 'p1',
      senderType: MailSenderType.SYSTEM,
      senderId: null,
      title: '系统奖励',
      content: '恭喜获得奖励',
      attachmentJson: { items: [{ templateId: '1001', quantity: 5 }] },
      batchId: null,
      templateId: null,
      isRead: false,
      isClaimed: false,
      expiredAt: null,
      createdAt: new Date(),
      ...overrides,
    }) as Mail;

  describe('getMails', () => {
    it('should return mails for player', async () => {
      mailRepo.find.mockResolvedValue([makeMail()]);

      const result = await service.getMails('p1');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('系统奖励');
    });

    it('should return empty array when no mails', async () => {
      mailRepo.find.mockResolvedValue([]);

      const result = await service.getMails('p1');

      expect(result).toEqual([]);
    });
  });

  describe('readMail', () => {
    it('should mark mail as read', async () => {
      mailRepo.findOne.mockResolvedValue(makeMail({ isRead: false }));

      const result = await service.readMail('p1', '1');

      expect(result.isRead).toBe(true);
      expect(mailRepo.save).toHaveBeenCalled();
    });

    it('should throw when mail not found', async () => {
      mailRepo.findOne.mockResolvedValue(null);

      await expect(service.readMail('p1', '999')).rejects.toThrow();
    });
  });

  describe('claimAttachment', () => {
    it('should grant items then mark as claimed', async () => {
      mailRepo.findOne.mockResolvedValue(makeMail({ isClaimed: false }));

      const result = await service.claimAttachment('p1', '1');

      expect(inventoryService.addItem).toHaveBeenCalledWith(
        'p1',
        '1001',
        5,
        'mail_claim',
      );
      expect(mailRepo.save).toHaveBeenCalled();
      expect(result.attachment).toEqual({
        items: [{ templateId: '1001', quantity: 5 }],
      });
      expect(result.isClaimed).toBe(true);
    });

    it('should grant currencies when attachment has them', async () => {
      mailRepo.findOne.mockResolvedValue(
        makeMail({
          attachmentJson: {
            currencies: [{ currencyType: 'gold', amount: 100 }],
          },
        }),
      );

      const result = await service.claimAttachment('p1', '1');

      expect(economyService.addCurrency).toHaveBeenCalledWith(
        'p1',
        'gold',
        100,
        'mail',
        'claim_attachment',
        '1',
      );
      expect(inventoryService.addItem).not.toHaveBeenCalled();
      expect(result.isClaimed).toBe(true);
    });

    it('should not mark claimed when granting fails', async () => {
      mailRepo.findOne.mockResolvedValue(makeMail({ isClaimed: false }));
      inventoryService.addItem.mockRejectedValueOnce(
        new Error('BAG_FULL mock'),
      );

      await expect(service.claimAttachment('p1', '1')).rejects.toThrow();
      expect(mailRepo.save).not.toHaveBeenCalled();
    });

    it('should throw when mail has no attachment', async () => {
      mailRepo.findOne.mockResolvedValue(
        makeMail({ attachmentJson: {} }),
      );

      await expect(service.claimAttachment('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.MAIL_NO_ATTACHMENT },
      });
    });

    it('should throw when attachment already claimed', async () => {
      mailRepo.findOne.mockResolvedValue(makeMail({ isClaimed: true }));

      await expect(service.claimAttachment('p1', '1')).rejects.toMatchObject({
        response: { code: ErrorCodes.MAIL_ATTACHMENT_CLAIMED },
      });
    });

    it('should throw when mail not found', async () => {
      mailRepo.findOne.mockResolvedValue(null);

      await expect(service.claimAttachment('p1', '999')).rejects.toMatchObject({
        response: { code: ErrorCodes.MAIL_NOT_FOUND },
      });
    });
  });

  describe('sendMail', () => {
    it('should create and save mail', async () => {
      const result = await service.sendMail({
        recipientId: 'p1',
        senderType: MailSenderType.SYSTEM,
        title: '系统奖励',
        content: '恭喜获得奖励',
        attachmentJson: { items: [] },
      });

      expect(result.title).toBe('系统奖励');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'mail.received',
        expect.any(Object),
      );
    });
  });

  describe('sendBatchMail', () => {
    it('should send mail to all online players', async () => {
      cacheService.sMembers.mockResolvedValue(['p1', 'p2', 'p3']);

      const result = await service.sendBatchMail({
        senderType: MailSenderType.SYSTEM,
        title: '全服公告',
        content: '服务器维护通知',
        attachmentJson: {},
      });

      expect(result.count).toBe(3);
      expect(mailRepo.save).toHaveBeenCalledTimes(3);
    });
  });

  describe('getMail', () => {
    it('should return single mail by id', async () => {
      mailRepo.findOne.mockResolvedValue(makeMail());

      const result = await service.getMail('1');

      expect(result?.title).toBe('系统奖励');
    });
  });

  describe('getMailList (admin)', () => {
    it('should return paginated mails', async () => {
      mailRepo.findAndCount.mockResolvedValue([[makeMail()], 1]);

      const result = await service.getMailList(1, 20);

      expect(result.items).toHaveLength(1);
    });
  });
});
