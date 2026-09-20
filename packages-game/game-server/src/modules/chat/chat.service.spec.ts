import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService } from './chat.service';
import {
  ChatMessage,
  ChatPlayerStat,
  ChatSignIn,
  SupportTicket,
  VoiceRoom,
} from './entities';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { ConfigManageService } from '@modules/config/config.service';
import { AdminService } from '@modules/admin/admin.service';
import { AuthService } from '@modules/auth/auth.service';
import { SocialService } from '@modules/social/social.service';
import { SocialEconomyService } from '@modules/social/social-economy.service';
import { Player } from '@modules/player/entities/player.entity';
import { Friend } from '@modules/social/entities/friend.entity';
import { GuildMember } from '@modules/social/entities/guild-member.entity';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  ChatChannel,
  SupportTicketStatus,
  VoiceRoomType,
  FriendStatus,
  SocialPointReason,
} from '@constants/enums';
import type { Repository } from 'typeorm';

describe('ChatService', () => {
  let service: ChatService;
  let chatRepo: jest.Mocked<Repository<ChatMessage>>;
  let statRepo: jest.Mocked<Repository<ChatPlayerStat>>;
  let signInRepo: jest.Mocked<Repository<ChatSignIn>>;
  let ticketRepo: jest.Mocked<Repository<SupportTicket>>;
  let voiceRoomRepo: jest.Mocked<Repository<VoiceRoom>>;
  let playerRepo: jest.Mocked<Repository<Player>>;
  let friendRepo: jest.Mocked<Repository<Friend>>;
  let guildMemberRepo: jest.Mocked<Repository<GuildMember>>;
  let cacheService: jest.Mocked<CacheService>;
  let configService: jest.Mocked<ConfigManageService>;
  let adminService: jest.Mocked<AdminService>;
  let eventBus: jest.Mocked<EventBusService>;
  let authService: any;
  let socialService: any;
  let socialEconomyService: any;

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
            createQueryBuilder: jest.fn(function (this: any) {
              const qb: any = {
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                take: jest.fn().mockReturnThis(),
                getMany: () => this.find(),
              };
              return qb;
            }),
          },
        },
        {
          provide: getRepositoryToken(ChatPlayerStat),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: getRepositoryToken(ChatSignIn),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
          },
        },
        {
          provide: getRepositoryToken(SupportTicket),
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
          provide: getRepositoryToken(VoiceRoom),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn((data: any) => ({ ...data })),
            save: jest
              .fn()
              .mockImplementation((data: any) => Promise.resolve(data)),
            remove: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: getRepositoryToken(Player),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(Friend),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(GuildMember),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: CacheService,
          useValue: {
            incr: jest.fn(),
            expire: jest.fn(),
            get: jest.fn(),
            set: jest.fn(),
            sMembers: jest.fn(),
          },
        },
        {
          provide: ConfigManageService,
          useValue: {
            getConfig: jest
              .fn()
              .mockRejectedValue(new Error('not found')), // 默认走 fallback
          },
        },
        {
          provide: AdminService,
          useValue: { logOperation: jest.fn() },
        },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
        {
          provide: AuthService,
          useValue: {
            getAccountRestrictions: jest.fn(),
          },
        },
        {
          provide: SocialService,
          useValue: {
            isBlocked: jest.fn(),
          },
        },
        {
          provide: SocialEconomyService,
          useValue: {
            spendPoints: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ChatService);
    chatRepo = module.get(getRepositoryToken(ChatMessage));
    statRepo = module.get(getRepositoryToken(ChatPlayerStat));
    signInRepo = module.get(getRepositoryToken(ChatSignIn));
    ticketRepo = module.get(getRepositoryToken(SupportTicket));
    voiceRoomRepo = module.get(getRepositoryToken(VoiceRoom));
    playerRepo = module.get(getRepositoryToken(Player));
    friendRepo = module.get(getRepositoryToken(Friend));
    guildMemberRepo = module.get(getRepositoryToken(GuildMember));
    cacheService = module.get(CacheService);
    configService = module.get(ConfigManageService);
    adminService = module.get(AdminService);
    eventBus = module.get(EventBusService);
    authService = module.get(AuthService);
    socialService = module.get(SocialService);
    socialEconomyService = module.get(SocialEconomyService);
    // 默认无禁言/无拉黑，避免既有 sendChannelMessage 用例受新校验影响
    authService.getAccountRestrictions.mockResolvedValue({
      mutedUntil: null,
      tradeLockedUntil: null,
    });
    socialService.isBlocked.mockResolvedValue(false);
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
  });

  describe('sendChannelMessage（统一入口）', () => {
    it('世界频道：等级达标 + 限频通过 + 统计/签到触发', async () => {
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 5 } as any);
      cacheService.incr.mockResolvedValue(1);
      cacheService.expire.mockResolvedValue(true);
      statRepo.findOne.mockResolvedValue(null);
      signInRepo.findOne.mockResolvedValue(null);

      const result = await service.sendChannelMessage({
        senderId: 'p1',
        senderName: '张三',
        channel: ChatChannel.WORLD,
        content: '大家好，今天天气不错',
      });

      expect(result.message.content).toBe('大家好，今天天气不错');
      expect(statRepo.save).toHaveBeenCalled();
      expect(signInRepo.save).toHaveBeenCalled(); // 世界频道当日首条 → 签到
    });

    it('世界频道等级不足拒绝', async () => {
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 1 } as any);
      const err: any = await service
        .sendChannelMessage({
          senderId: 'p1',
          senderName: '张三',
          channel: ChatChannel.WORLD,
          content: 'hello',
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(GameException);
      expect(err.response.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('限频拦截（5秒内第2条）', async () => {
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 5 } as any);
      cacheService.incr.mockResolvedValue(2);
      const err: any = await service
        .sendChannelMessage({
          senderId: 'p1',
          senderName: '张三',
          channel: ChatChannel.WORLD,
          content: 'hello world',
        })
        .catch((e) => e);
      expect(err.response.code).toBe(ErrorCodes.RATE_LIMIT_EXCEEDED);
    });

    it('帮派频道非帮众拒绝', async () => {
      guildMemberRepo.findOne.mockResolvedValue(null);
      const err: any = await service
        .sendChannelMessage({
          senderId: 'p1',
          senderName: '张三',
          channel: ChatChannel.GUILD,
          content: 'hello',
          guildId: 'g1',
        })
        .catch((e) => e);
      expect(err.response.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('私聊频道非好友拒绝', async () => {
      friendRepo.findOne.mockResolvedValue(null);
      const err: any = await service
        .sendChannelMessage({
          senderId: 'p1',
          senderName: '张三',
          channel: ChatChannel.PRIVATE,
          content: 'hello',
          recipientId: 'p2',
        })
        .catch((e) => e);
      expect(err.response.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('命中客服关键词返回自动回复', async () => {
      playerRepo.findOne.mockResolvedValue({ id: 'p1', level: 5 } as any);
      cacheService.incr.mockResolvedValue(1);
      cacheService.expire.mockResolvedValue(true);
      statRepo.findOne.mockResolvedValue(null);
      signInRepo.findOne.mockResolvedValue(null);

      const result = await service.sendChannelMessage({
        senderId: 'p1',
        senderName: '张三',
        channel: ChatChannel.WORLD,
        content: '我要投诉这个bug',
      });

      expect(result.supportReply).toBeTruthy();
      expect(ticketRepo.save).toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.stringContaining('support'),
        expect.any(Object),
      );
    });
  });

  describe('channelSignIn', () => {
    it('今日首签成功并发事件', async () => {
      signInRepo.findOne.mockResolvedValue(null);
      const result = await service.channelSignIn('p1');
      expect(result.rewardJson).toEqual({ favor: 1 });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'chat.sign_in',
        expect.any(Object),
      );
    });

    it('重复签到拒绝', async () => {
      signInRepo.findOne.mockResolvedValue({ id: '9' } as any);
      const err: any = await service.channelSignIn('p1').catch((e) => e);
      expect(err.response.code).toBe(ErrorCodes.CHAT_SIGN_IN_DONE);
    });
  });

  describe('getHotTopics', () => {
    it('话题聚合计数并按热度排序', async () => {
      cacheService.get.mockResolvedValue(null);
      chatRepo.find.mockResolvedValue([
        makeMessage({ content: '#江湖大会 今天开打 @张三' }),
        makeMessage({ content: '#江湖大会 再战一轮' }),
        makeMessage({ content: '#京城风云 论剑' }),
      ]);

      const result = await service.getHotTopics(1, 10);

      expect(result.topics[0]).toEqual({ name: '#江湖大会', count: 2 });
      expect(result.mentions[0]).toEqual({ name: '@张三', count: 1 });
      expect(cacheService.set).toHaveBeenCalled();
    });

    it('无话题空数据抛错', async () => {
      cacheService.get.mockResolvedValue(null);
      chatRepo.find.mockResolvedValue([makeMessage({ content: '普通消息' })]);
      const err: any = await service.getHotTopics(1, 10).catch((e) => e);
      expect(err.response.code).toBe(ErrorCodes.CHAT_TOPIC_EMPTY);
    });
  });

  describe('drawLuckyStar', () => {
    it('去水过滤后抽取并审计', async () => {
      chatRepo.find.mockResolvedValue([
        makeMessage({ senderId: 'p1', content: '这是一条足够长的有效发言消息' }),
        makeMessage({ senderId: 'p2', content: '短' }),
      ]);
      const result = await service.drawLuckyStar('1', 3, 1);
      expect(result.players).toEqual(['p1']);
      expect(adminService.logOperation).toHaveBeenCalled();
    });

    it('无候选拒绝', async () => {
      chatRepo.find.mockResolvedValue([makeMessage({ content: '短' })]);
      const err: any = await service.drawLuckyStar('1', 3, 1).catch((e) => e);
      expect(err.response.code).toBe(ErrorCodes.LUCKY_STAR_NO_CANDIDATE);
    });
  });

  describe('replyTicket', () => {
    it('GM回复后工单关闭', async () => {
      ticketRepo.findOne.mockResolvedValue({
        id: '1',
        status: SupportTicketStatus.NEEDS_GM,
      } as any);
      const result = await service.replyTicket('1', '1', '已处理，补偿发放');
      expect(result.status).toBe(SupportTicketStatus.RESOLVED);
      expect(result.gmReply).toBe('已处理，补偿发放');
    });

    it('工单不存在拒绝', async () => {
      ticketRepo.findOne.mockResolvedValue(null);
      const err: any = await service
        .replyTicket('1', '99', '回复')
        .catch((e) => e);
      expect(err.response.code).toBe(ErrorCodes.SUPPORT_TICKET_NOT_FOUND);
    });
  });

  describe('语音房', () => {
    it('创建房间自动入座', async () => {
      const result = await service.createVoiceRoom(
        'p1',
        '茶馆',
        VoiceRoomType.TEA_HOUSE,
      );
      expect(result.members).toEqual(['p1']);
    });

    it('满员拒绝加入', async () => {
      voiceRoomRepo.findOne.mockResolvedValue({
        id: '1',
        maxMembers: 1,
        members: ['p1'],
      } as any);
      const err: any = await service
        .joinVoiceRoom('p2', '1')
        .catch((e) => e);
      expect(err.response.code).toBe(ErrorCodes.VOICE_ROOM_FULL);
    });

    it('最后一人离开自动删房', async () => {
      voiceRoomRepo.findOne.mockResolvedValue({
        id: '1',
        maxMembers: 8,
        members: ['p1'],
      } as any);
      const result = await service.leaveVoiceRoom('p1', '1');
      expect(result).toEqual({ closed: true });
      expect(voiceRoomRepo.remove).toHaveBeenCalled();
    });
  });

  describe('发言限制（禁言/拉黑）', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('禁言未过期拒绝发言', async () => {
      // checkChannelPermission(世界频道) 与 enforceChatRestrictions 各查一次 player
      playerRepo.findOne.mockResolvedValue({ id: '100', accountId: '1' } as any);
      authService.getAccountRestrictions.mockResolvedValue({
        mutedUntil: new Date(Date.now() + 3600_000),
        tradeLockedUntil: null,
      });
      await expect(
        service.sendChannelMessage({
          senderId: '100',
          senderName: 'A',
          channel: ChatChannel.WORLD,
          content: 'hello',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.ACCOUNT_MUTED } });
    });

    it('禁言已过期放行', async () => {
      playerRepo.findOne.mockResolvedValue({ id: '100', accountId: '1' } as any);
      authService.getAccountRestrictions.mockResolvedValue({
        mutedUntil: null,
        tradeLockedUntil: null,
      });
      cacheService.incr.mockResolvedValue(1);
      cacheService.expire.mockResolvedValue(true);
      statRepo.findOne.mockResolvedValue(null);
      signInRepo.findOne.mockResolvedValue(null);
      const result = await service.sendChannelMessage({
        senderId: '100',
        senderName: 'A',
        channel: ChatChannel.WORLD,
        content: 'hello',
      });
      expect(result.message).toBeDefined();
    });

    it('私聊被对方拉黑拒绝', async () => {
      friendRepo.findOne.mockResolvedValue({
        playerId: '100',
        friendId: '200',
        status: FriendStatus.ACCEPTED,
      } as any);
      playerRepo.findOne.mockResolvedValue({ id: '100', accountId: '1' } as any);
      authService.getAccountRestrictions.mockResolvedValue({
        mutedUntil: null,
        tradeLockedUntil: null,
      });
      socialService.isBlocked.mockResolvedValue(true);
      await expect(
        service.sendChannelMessage({
          senderId: '100',
          senderName: 'A',
          channel: ChatChannel.PRIVATE,
          content: 'hi',
          recipientId: '200',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCodes.TARGET_BLOCKED_YOU } });
    });
  });

  describe('makeupSignIn', () => {
    it('补签过去日期成功并扣积分', async () => {
      signInRepo.findOne.mockResolvedValue(null);
      cacheService.get.mockResolvedValue('0');
      configService.getConfig.mockResolvedValue({ value: '50' }); // makeup_cost
      socialEconomyService.spendPoints.mockResolvedValue(50);
      const record = await service.makeupSignIn('1', '2026-09-18');
      expect(record.rewardJson.makeup).toBe(true);
      expect(socialEconomyService.spendPoints).toHaveBeenCalledWith(
        '1',
        50,
        SocialPointReason.SIGN_IN_MAKEUP,
        'signin:2026-09-18',
      );
    });

    it('补签今日拒绝', async () => {
      await expect(service.makeupSignIn('1', '2099-01-01')).rejects.toMatchObject(
        {
          response: { code: ErrorCodes.MAKEUP_INVALID_DATE },
        },
      );
    });

    it('补签超月度上限拒绝', async () => {
      signInRepo.findOne.mockResolvedValue(null);
      cacheService.get.mockResolvedValue('3');
      configService.getConfig.mockResolvedValue({ value: '3' });
      await expect(
        service.makeupSignIn('1', '2026-09-18'),
      ).rejects.toMatchObject({
        response: { code: ErrorCodes.MAKEUP_LIMIT_EXCEEDED },
      });
    });
  });
});
