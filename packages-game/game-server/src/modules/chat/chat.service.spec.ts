import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService } from './chat.service';
import { ChatMessage } from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { ChatChannel } from '@constants/enums';
import type { Repository } from 'typeorm';

describe('ChatService', () => {
  let service: ChatService;
  let chatRepo: jest.Mocked<Repository<ChatMessage>>;
  let cacheService: jest.Mocked<CacheService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(ChatMessage),
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
        {
          provide: CacheService,
          useValue: {
            sMembers: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
          },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(ChatService);
    chatRepo = module.get(getRepositoryToken(ChatMessage));
    cacheService = module.get(CacheService);
    eventBus = module.get(EventBusService);
  });

  const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage =>
    ({
      id: '1',
      channel: ChatChannel.WORLD,
      senderId: 'p1',
      senderName: '张三',
      recipientId: null,
      guildId: null,
      content: '大家好',
      createdAt: new Date(),
      ...overrides,
    }) as ChatMessage;

  describe('sendWorldMessage', () => {
    it('should save and broadcast world message', async () => {
      const result = await service.sendWorldMessage('p1', '张三', '大家好');

      expect(result.content).toBe('大家好');
      expect(result.channel).toBe(ChatChannel.WORLD);
      expect(chatRepo.save).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        'chat.world',
        expect.any(Object),
      );
    });

    it('should filter sensitive words', async () => {
      const result = await service.sendWorldMessage('p1', '张三', '你这sb');

      expect(result.content).toBe('你这**');
    });
  });

  describe('sendPrivateMessage', () => {
    it('should save and emit private message', async () => {
      const result = await service.sendPrivateMessage(
        'p1',
        '张三',
        'p2',
        '私聊你好',
      );

      expect(result.channel).toBe(ChatChannel.PRIVATE);
      expect(result.recipientId).toBe('p2');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'chat.private',
        expect.any(Object),
      );
    });
  });

  describe('sendGuildMessage', () => {
    it('should save and emit guild message', async () => {
      const result = await service.sendGuildMessage(
        'p1',
        '张三',
        'g1',
        '公会大家好',
      );

      expect(result.channel).toBe(ChatChannel.GUILD);
      expect(result.guildId).toBe('g1');
      expect(eventBus.emit).toHaveBeenCalledWith(
        'chat.guild',
        expect.any(Object),
      );
    });
  });

  describe('getChatHistory', () => {
    it('should return messages for channel', async () => {
      chatRepo.find.mockResolvedValue([makeMessage()]);

      const result = await service.getChatHistory(ChatChannel.WORLD, 20);

      expect(result).toHaveLength(1);
    });

    it('should return empty array when no messages', async () => {
      chatRepo.find.mockResolvedValue([]);

      const result = await service.getChatHistory(ChatChannel.WORLD, 20);

      expect(result).toEqual([]);
    });
  });

  describe('getChatHistory (admin)', () => {
    it('should return paginated messages', async () => {
      chatRepo.findAndCount.mockResolvedValue([[makeMessage()], 1]);

      const result = await service.getChatLogList(1, 20);

      expect(result.items).toHaveLength(1);
    });
  });
});
