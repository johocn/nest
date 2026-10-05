import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ChatAdminController } from './chat-admin.controller';
import { ChatService } from './chat.service';
import { AdminSessionService } from '@modules/auth/admin-session.service';

describe('ChatAdminController', () => {
  let ctrl: ChatAdminController;
  const chatService = {
    searchMessages: jest.fn(),
    listTickets: jest.fn(),
    replyTicket: jest.fn(),
    drawLuckyStar: jest.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ChatAdminController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'secret') } },
        {
          provide: AdminSessionService,
          useValue: { validate: jest.fn().mockResolvedValue(true) },
        },
        Reflector,
      ],
    }).compile();
    ctrl = mod.get(ChatAdminController);
  });
  beforeEach(() => jest.clearAllMocks());

  it('控制器受 AdminGuard 保护（Guard 元数据存在）', () => {
    const guards = Reflect.getMetadata('__guards__', ChatAdminController);
    expect(guards).toBeDefined();
    expect(String(guards?.[0]?.name ?? guards?.[0])).toContain('AdminGuard');
  });

  describe('listChatMessages', () => {
    it('调用 service.searchMessages 并返回 mapChatMessage 后的 items', async () => {
      const raw = {
        items: [
          {
            id: 'm1',
            channel: 'guild',
            senderName: '张三',
            recipientId: null,
            guildId: 'g1',
            content: '大家好',
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      };
      chatService.searchMessages.mockResolvedValue(raw);
      const res = await ctrl.listChatMessages('guild', undefined, undefined, '1', '20');
      expect(chatService.searchMessages).toHaveBeenCalledWith(
        { channel: 'guild', senderId: undefined, keyword: undefined },
        1,
        20,
      );
      expect(res.items[0].channelType).toBe('guild');
      expect(res.items[0].sender).toBe('张三');
      expect(res.items[0].message).toBe('大家好');
    });
  });

  describe('listSupportTickets', () => {
    it('调用 service.listTickets 并返回 mapTicket 后的 items', async () => {
      const raw = {
        items: [
          {
            id: 't1',
            playerId: 'p1',
            channel: 'bug',
            keyword: '无法登录',
            content: '登不上去',
            status: 'pending',
            autoReply: '请稍候',
            gmReply: null,
            adminId: null,
            handledAt: null,
            createdAt: '2025-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      };
      chatService.listTickets.mockResolvedValue(raw);
      const res = await ctrl.listSupportTickets(undefined, '1', '20');
      expect(chatService.listTickets).toHaveBeenCalledWith(undefined, 1, 20);
      expect(res.items[0].category).toBe('bug');
      expect(res.items[0].question).toBe('登不上去');
    });
  });

  describe('replyTicket', () => {
    it('调用 service.replyTicket 并返回 mapTicket 后的 ticket', async () => {
      const updated = {
        id: 't1',
        playerId: 'p1',
        channel: 'bug',
        keyword: '',
        content: '登不上去',
        status: 'replied',
        autoReply: null,
        gmReply: '问题已修复',
        adminId: 'admin-1',
        handledAt: '2025-01-02T00:00:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      chatService.replyTicket.mockResolvedValue(updated);
      const res = await ctrl.replyTicket({ adminId: 'admin-1' }, 't1', { reply: '问题已修复' });
      expect(chatService.replyTicket).toHaveBeenCalledWith('admin-1', 't1', '问题已修复');
      expect(res.gmReply).toBe('问题已修复');
      expect(res.adminId).toBe('admin-1');
    });
  });

  describe('drawLuckyStar', () => {
    it('调用 service.drawLuckyStar 用默认 count=10 / days=1', async () => {
      chatService.drawLuckyStar.mockResolvedValue({ winners: ['p1', 'p2'] });
      const res = await ctrl.drawLuckyStar({ adminId: 'admin-1' }, {});
      expect(chatService.drawLuckyStar).toHaveBeenCalledWith('admin-1', 10, 1);
      expect(res).toEqual({ winners: ['p1', 'p2'] });
    });

    it('调用 service.drawLuckyStar 时 body 参数覆盖默认值', async () => {
      await ctrl.drawLuckyStar({ adminId: 'admin-2' }, { count: 50, days: 7 });
      expect(chatService.drawLuckyStar).toHaveBeenCalledWith('admin-2', 50, 7);
    });
  });
});
