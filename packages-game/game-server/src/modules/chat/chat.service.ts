import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ChatMessage,
  ChatPlayerStat,
  ChatSignIn,
  SupportTicket,
  VoiceRoom,
} from './entities';
import { SensitiveWordFilter } from './utils/sensitive-word.util';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import {
  ChatChannel,
  FriendStatus,
  SupportTicketStatus,
  VoiceRoomType,
} from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ConfigManageService } from '@modules/config/config.service';
import { AdminService } from '@modules/admin/admin.service';
import { AuthService } from '@modules/auth/auth.service';
import { SocialService } from '@modules/social/social.service';
import { SocialEconomyService } from '@modules/social/social-economy.service';
import { SocialPointReason } from '@constants/enums';
import { Player } from '@modules/player/entities/player.entity';
import { Friend } from '@modules/social/entities/friend.entity';
import { GuildMember } from '@modules/social/entities/guild-member.entity';

const CHAT_RATE_KEY = (playerId: string) => `chat:rate:${playerId}`;
const CHAT_RATE_SECONDS = 5;
const HOT_TOPIC_CACHE_PREFIX = 'chat:hot:';
const HOT_TOPIC_CACHE_TTL = 60;

const DEFAULT_LEVEL_THRESHOLDS: Record<number, number> = {
  0: 0,
  1: 10,
  2: 50,
  3: 200,
};

export interface SendChannelParams {
  senderId: string;
  senderName: string;
  channel: ChatChannel;
  content: string;
  recipientId?: string;
  guildId?: string;
}

export interface SendChannelResult {
  message: ChatMessage;
  supportReply: string | null;
}

@Injectable()
export class ChatService {
  private readonly filter: SensitiveWordFilter;

  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatRepo: Repository<ChatMessage>,
    @InjectRepository(ChatPlayerStat)
    private readonly statRepo: Repository<ChatPlayerStat>,
    @InjectRepository(ChatSignIn)
    private readonly signInRepo: Repository<ChatSignIn>,
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(VoiceRoom)
    private readonly voiceRoomRepo: Repository<VoiceRoom>,
    @InjectRepository(Player)
    private readonly playerRepo: Repository<Player>,
    @InjectRepository(Friend)
    private readonly friendRepo: Repository<Friend>,
    @InjectRepository(GuildMember)
    private readonly guildMemberRepo: Repository<GuildMember>,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigManageService,
    private readonly adminService: AdminService,
    private readonly eventBus: EventBusService,
    private readonly authService: AuthService,
    private readonly socialService: SocialService,
    private readonly socialEconomyService: SocialEconomyService,
  ) {
    this.filter = new SensitiveWordFilter();
  }

  async sendWorldMessage(
    senderId: string,
    senderName: string,
    content: string,
  ): Promise<ChatMessage> {
    const filtered = this.filter.filter(content);
    const message = this.chatRepo.create({
      channel: ChatChannel.WORLD,
      senderId,
      senderName,
      recipientId: null,
      guildId: null,
      content: filtered,
    });
    const saved = await this.chatRepo.save(message);

    this.eventBus.emit(GameEvents.CHAT_WORLD, {
      senderId,
      senderName,
      content: filtered,
      messageId: saved.id,
    });

    return saved;
  }

  async sendPrivateMessage(
    senderId: string,
    senderName: string,
    recipientId: string,
    content: string,
  ): Promise<ChatMessage> {
    const filtered = this.filter.filter(content);
    const message = this.chatRepo.create({
      channel: ChatChannel.PRIVATE,
      senderId,
      senderName,
      recipientId,
      guildId: null,
      content: filtered,
    });
    const saved = await this.chatRepo.save(message);

    this.eventBus.emit(GameEvents.CHAT_PRIVATE, {
      senderId,
      senderName,
      recipientId,
      content: filtered,
      messageId: saved.id,
    });

    return saved;
  }

  async sendGuildMessage(
    senderId: string,
    senderName: string,
    guildId: string,
    content: string,
  ): Promise<ChatMessage> {
    const filtered = this.filter.filter(content);
    const message = this.chatRepo.create({
      channel: ChatChannel.GUILD,
      senderId,
      senderName,
      recipientId: null,
      guildId,
      content: filtered,
    });
    const saved = await this.chatRepo.save(message);

    this.eventBus.emit(GameEvents.CHAT_GUILD, {
      senderId,
      senderName,
      guildId,
      content: filtered,
      messageId: saved.id,
    });

    return saved;
  }

  async getChatHistory(
    channel: ChatChannel,
    limit = 50,
  ): Promise<ChatMessage[]> {
    return this.chatRepo.find({
      where: { channel },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getChatLogList(
    page: number,
    limit: number,
  ): Promise<{ items: ChatMessage[]; total: number }> {
    const [items, total] = await this.chatRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  // ===== 统一发言入口（14.8）=====

  async sendChannelMessage(
    params: SendChannelParams,
  ): Promise<SendChannelResult> {
    const { senderId, senderName, channel, content, recipientId, guildId } =
      params;
    await this.checkChannelPermission(senderId, channel, recipientId, guildId);
    await this.enforceChatRestrictions(senderId, channel, recipientId);
    await this.checkRateLimit(senderId);

    const filtered = this.filter.filter(content);
    if (!filtered.trim()) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '消息内容无效');
    }
    const message = this.chatRepo.create({
      channel,
      senderId,
      senderName,
      recipientId: recipientId ?? null,
      guildId: guildId ?? null,
      content: filtered,
    });
    const saved = await this.chatRepo.save(message);
    await this.bumpStat(senderId, channel);

    if (channel === ChatChannel.WORLD) {
      await this.channelSignIn(senderId).catch(() => undefined);
    }
    const support = await this.checkSupportTrigger(senderId, channel, filtered);

    return { message: saved, supportReply: support.autoReply ?? null };
  }

  private async enforceChatRestrictions(
    senderId: string,
    channel: ChatChannel,
    recipientId?: string,
  ): Promise<void> {
    const player = await this.playerRepo.findOne({ where: { id: senderId } });
    if (player) {
      const restrictions = await this.authService.getAccountRestrictions(
        player.accountId,
      );
      if (restrictions.mutedUntil) {
        throw new GameException(ErrorCodes.ACCOUNT_MUTED, '账号禁言中', {
          until: restrictions.mutedUntil,
        });
      }
    }
    if (channel === ChatChannel.PRIVATE && recipientId) {
      const blocked = await this.socialService.isBlocked(senderId, recipientId);
      if (blocked) {
        throw new GameException(
          ErrorCodes.TARGET_BLOCKED_YOU,
          '无法向对方发送消息',
        );
      }
    }
  }

  async getSenderName(playerId: string): Promise<string> {
    const player = await this.playerRepo.findOne({ where: { id: playerId } });
    return player?.nickname ?? String(playerId);
  }

  private async checkChannelPermission(
    senderId: string,
    channel: ChatChannel,
    recipientId?: string,
    guildId?: string,
  ): Promise<void> {
    if (channel === ChatChannel.WORLD) {
      const req = await this.readConfigNumber('chat.world_level_req', 3);
      const player = await this.playerRepo.findOne({ where: { id: senderId } });
      if (!player || player.level < req) {
        throw new GameException(
          ErrorCodes.FORBIDDEN,
          `世界频道需等级${req}解锁`,
        );
      }
    } else if (channel === ChatChannel.GUILD) {
      if (!guildId) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '缺少帮派ID');
      }
      const member = await this.guildMemberRepo.findOne({
        where: { guildId, playerId: senderId },
      });
      if (!member) {
        throw new GameException(ErrorCodes.FORBIDDEN, '不在帮派中，无法发言');
      }
    } else if (channel === ChatChannel.PRIVATE) {
      if (!recipientId) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '缺少私聊对象');
      }
      const friend = await this.friendRepo.findOne({
        where: [
          {
            playerId: senderId,
            friendId: recipientId,
            status: FriendStatus.ACCEPTED,
          },
          {
            playerId: recipientId,
            friendId: senderId,
            status: FriendStatus.ACCEPTED,
          },
        ],
      });
      if (!friend) {
        throw new GameException(ErrorCodes.FORBIDDEN, '仅好友可私聊');
      }
    }
  }

  private async checkRateLimit(playerId: string): Promise<void> {
    const key = CHAT_RATE_KEY(playerId);
    const count = await this.cacheService.incr(key);
    if (count === 1) {
      await this.cacheService.expire(key, CHAT_RATE_SECONDS);
    }
    if (count > 1) {
      throw new GameException(ErrorCodes.RATE_LIMIT_EXCEEDED, '发言过于频繁');
    }
  }

  // ===== 频道签到 + 频道等级（14.8）=====

  async channelSignIn(playerId: string): Promise<ChatSignIn> {
    const today = new Date().toISOString().slice(0, 10);
    const existing = await this.signInRepo.findOne({
      where: { playerId, signInDate: today },
    });
    if (existing) {
      throw new GameException(ErrorCodes.CHAT_SIGN_IN_DONE, '今日已签到');
    }
    const reward = await this.readConfigJson('chat.sign_in_reward', {
      favor: 1,
    });
    const record = await this.signInRepo.save(
      this.signInRepo.create({
        playerId,
        signInDate: today,
        rewardJson: reward,
      }),
    );
    this.eventBus.emit(GameEvents.CHAT_SIGN_IN, {
      playerId,
      signInDate: today,
      reward,
    });
    return record;
  }

  async getSignInStatus(playerId: string): Promise<{
    signedIn: boolean;
    today: string;
  }> {
    const today = new Date().toISOString().slice(0, 10);
    const existing = await this.signInRepo.findOne({
      where: { playerId, signInDate: today },
    });
    return { signedIn: Boolean(existing), today };
  }

  async makeupSignIn(
    playerId: string,
    date: string,
  ): Promise<ChatSignIn> {
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= today) {
      throw new GameException(ErrorCodes.MAKEUP_INVALID_DATE, '仅可补签过去的日期');
    }
    const existing = await this.signInRepo.findOne({
      where: { playerId, signInDate: date },
    });
    if (existing) {
      throw new GameException(ErrorCodes.CHAT_SIGN_IN_DONE, '该日已签到');
    }
    const monthKey = date.slice(0, 7);
    const limit = await this.readConfigNumber('chat.makeup_monthly_limit', 3);
    const countKey = `chat:makeup:${playerId}:${monthKey}`;
    const used = Number((await this.cacheService.get(countKey)) ?? '0');
    if (used >= limit) {
      throw new GameException(ErrorCodes.MAKEUP_LIMIT_EXCEEDED, '本月补签次数已达上限');
    }
    const cost = await this.readConfigNumber('chat.makeup_cost', 50);
    await this.socialEconomyService.spendPoints(
      playerId,
      cost,
      SocialPointReason.SIGN_IN_MAKEUP,
      `signin:${date}`,
    );
    await this.cacheService.set(countKey, String(used + 1), 31 * 86400);

    const reward = await this.readConfigJson('chat.sign_in_reward', { favor: 1 });
    const record = await this.signInRepo.save(
      this.signInRepo.create({
        playerId,
        signInDate: date,
        rewardJson: { ...reward, makeup: true },
      }),
    );
    this.eventBus.emit(GameEvents.CHAT_SIGN_IN, {
      playerId,
      signInDate: date,
      reward,
      makeup: true,
    });
    return record;
  }

  async getMyChatStats(playerId: string): Promise<ChatPlayerStat[]> {
    return this.statRepo.find({
      where: { playerId },
      order: { channel: 'ASC' },
    });
  }

  // ===== 江湖热搜（14.9）=====

  async getHotTopics(
    days = 1,
    limit = 10,
  ): Promise<{ topics: { name: string; count: number }[]; mentions: { name: string; count: number }[] }> {
    const cacheKey = HOT_TOPIC_CACHE_PREFIX + days;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const start = `now() - (${days} * interval '1 day')`;
    const messages = await this.chatRepo
      .createQueryBuilder('m')
      .where('m.channel = :channel', { channel: ChatChannel.WORLD })
      .andWhere(`m.created_at >= ${start}`)
      .orderBy('m.created_at', 'DESC')
      .take(2000)
      .getMany();

    const topicCount = new Map<string, number>();
    const mentionCount = new Map<string, number>();
    for (const m of messages) {
      const topics = m.content.match(/#[\u4e00-\u9fa5\w]+/g) ?? [];
      const mentions = m.content.match(/@[\u4e00-\u9fa5\w]{2,32}/g) ?? [];
      for (const t of topics) {
        topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
      }
      for (const mt of mentions) {
        mentionCount.set(mt, (mentionCount.get(mt) ?? 0) + 1);
      }
    }
    const topics = Array.from(topicCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
    const mentions = Array.from(mentionCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    if (!topics.length && !mentions.length) {
      throw new GameException(ErrorCodes.CHAT_TOPIC_EMPTY, '暂无热搜话题');
    }
    const result = { topics, mentions };
    await this.cacheService.set(cacheKey, JSON.stringify(result), HOT_TOPIC_CACHE_TTL);
    return result;
  }

  // ===== 频道幸运星（14.10）=====

  async drawLuckyStar(
    adminId: string,
    count = 3,
    days = 1,
  ): Promise<{ players: string[]; reward: Record<string, any> }> {
    const start = `now() - (${days} * interval '1 day')`;
    const messages = await this.chatRepo
      .createQueryBuilder('m')
      .where('m.channel = :channel', { channel: ChatChannel.WORLD })
      .andWhere(`m.created_at >= ${start}`)
      .orderBy('m.created_at', 'DESC')
      .getMany();
    const valid = messages.filter((m) => m.content.length >= 8);
    const playerIds = Array.from(new Set(valid.map((m) => m.senderId)));
    if (!playerIds.length) {
      throw new GameException(
        ErrorCodes.LUCKY_STAR_NO_CANDIDATE,
        '近几天无有效发言玩家',
      );
    }
    const players = playerIds
      .sort(() => Math.random() - 0.5)
      .slice(0, count);
    const reward = await this.readConfigJson('chat.lucky_star_reward', {
      favor: 5,
    });
    const result = { players, reward };
    this.eventBus.emit(GameEvents.LUCKY_STAR_DRAWN, {
      adminId,
      players,
      reward,
    });
    await this.adminService.logOperation({
      adminId,
      operation: 'chat.lucky_star.draw',
      changeAfter: result,
    });
    return result;
  }

  // ===== 客服引导（14.11）=====

  async getMyTickets(playerId: string): Promise<SupportTicket[]> {
    return this.ticketRepo.find({
      where: { playerId },
      order: { createdAt: 'DESC' },
    });
  }

  async listTickets(
    status?: SupportTicketStatus,
    page = 1,
    limit = 20,
  ): Promise<{ items: SupportTicket[]; total: number }> {
    const where =
      status && Object.values(SupportTicketStatus).includes(status)
        ? { status }
        : {};
    const [items, total] = await this.ticketRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async replyTicket(
    adminId: string,
    id: string,
    reply: string,
  ): Promise<SupportTicket> {
    if (!reply?.trim()) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '回复内容不能为空');
    }
    const ticket = await this.ticketRepo.findOne({ where: { id } });
    if (!ticket) {
      throw new GameException(
        ErrorCodes.SUPPORT_TICKET_NOT_FOUND,
        '工单不存在',
      );
    }
    ticket.gmReply = reply.trim();
    ticket.adminId = adminId;
    ticket.handledAt = new Date();
    ticket.status = SupportTicketStatus.RESOLVED;
    return this.ticketRepo.save(ticket);
  }

  private async checkSupportTrigger(
    playerId: string,
    channel: string,
    content: string,
  ): Promise<{ autoReply: string | null }> {
    const keywords = await this.readConfigJson('support.keywords', [
      '投诉',
      '举报',
      '申诉',
      '退款',
      'GM',
      '客服',
    ]);
    const gmKeywords = await this.readConfigJson('support.gm_keywords', [
      'GM',
      '客服',
      '充值问题',
      '退款',
    ]);
    const hit = (keywords as string[]).find((k) => content.includes(k));
    if (!hit) return { autoReply: null };
    const isGm = (gmKeywords as string[]).some((k) => content.includes(k));
    const autoReply = isGm
      ? '已为您转接GM人工处理，请耐心等待回复。'
      : '您的反馈已记录，我们会尽快处理。';
    const ticket = await this.ticketRepo.save(
      this.ticketRepo.create({
        playerId,
        channel,
        keyword: hit,
        content,
        status: isGm
          ? SupportTicketStatus.NEEDS_GM
          : SupportTicketStatus.AUTO_REPLIED,
        autoReply,
      }),
    );
    this.eventBus.emit(GameEvents.SUPPORT_TICKET_CREATED, {
      ticketId: ticket.id,
      playerId,
      keyword: hit,
    });
    return { autoReply };
  }

  // ===== 语音房（14.12，骨架）=====

  async createVoiceRoom(
    playerId: string,
    roomName: string,
    roomType: VoiceRoomType,
    maxMembers = 8,
  ): Promise<VoiceRoom> {
    const room = await this.voiceRoomRepo.save(
      this.voiceRoomRepo.create({
        roomName,
        ownerId: playerId,
        roomType,
        members: [playerId],
        maxMembers,
      }),
    );
    this.eventBus.emit(GameEvents.VOICE_ROOM_JOINED, {
      roomId: room.id,
      playerId,
    });
    return room;
  }

  async joinVoiceRoom(playerId: string, roomId: string): Promise<VoiceRoom> {
    const room = await this.voiceRoomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new GameException(ErrorCodes.VOICE_ROOM_NOT_FOUND, '语音房不存在');
    }
    if (room.members.includes(playerId)) return room;
    if (room.members.length >= room.maxMembers) {
      throw new GameException(ErrorCodes.VOICE_ROOM_FULL, '语音房已满');
    }
    room.members = [...room.members, playerId];
    const saved = await this.voiceRoomRepo.save(room);
    this.eventBus.emit(GameEvents.VOICE_ROOM_JOINED, {
      roomId: room.id,
      playerId,
    });
    return saved;
  }

  async leaveVoiceRoom(
    playerId: string,
    roomId: string,
  ): Promise<VoiceRoom | { closed: boolean }> {
    const room = await this.voiceRoomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new GameException(ErrorCodes.VOICE_ROOM_NOT_FOUND, '语音房不存在');
    }
    if (!room.members.includes(playerId)) return room;
    room.members = room.members.filter((m) => m !== playerId);
    if (!room.members.length) {
      await this.voiceRoomRepo.remove(room);
      this.eventBus.emit(GameEvents.VOICE_ROOM_LEFT, {
        roomId,
        playerId,
        closed: true,
      });
      return { closed: true };
    }
    const saved = await this.voiceRoomRepo.save(room);
    this.eventBus.emit(GameEvents.VOICE_ROOM_LEFT, {
      roomId,
      playerId,
      closed: false,
    });
    return saved;
  }

  async getVoiceRooms(roomType?: VoiceRoomType): Promise<VoiceRoom[]> {
    const where = roomType ? { roomType } : {};
    return this.voiceRoomRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  // ===== 私有 =====

  private async bumpStat(
    playerId: string,
    channel: ChatChannel,
  ): Promise<void> {
    let stat = await this.statRepo.findOne({ where: { playerId, channel } });
    if (!stat) {
      stat = this.statRepo.create({
        playerId,
        channel,
        msgCount: 0,
        level: 0,
      });
    }
    stat.msgCount += 1;
    stat.level = await this.levelForCount(stat.msgCount);
    await this.statRepo.save(stat);
  }

  private async levelForCount(count: number): Promise<number> {
    const thresholds = await this.readConfigJson(
      'chat.level_thresholds',
      DEFAULT_LEVEL_THRESHOLDS,
    );
    let level = 0;
    for (const [lvl, min] of Object.entries(thresholds)) {
      if (count >= Number(min)) level = Number(lvl);
    }
    return level;
  }

  private async readConfigNumber(
    key: string,
    fallback: number,
  ): Promise<number> {
    try {
      const config = await this.configService.getConfig(key);
      return Number(config.value) || fallback;
    } catch {
      return fallback;
    }
  }

  private async readConfigJson(
    key: string,
    fallback: any,
  ): Promise<any> {
    try {
      const config = await this.configService.getConfig(key);
      return JSON.parse(config.value);
    } catch {
      return fallback;
    }
  }
}
