import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessage } from './entities';
import { SensitiveWordFilter } from './utils/sensitive-word.util';
import { CacheService } from '@cache/cache.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { ChatChannel } from '@constants/enums';

@Injectable()
export class ChatService {
  private readonly filter: SensitiveWordFilter;

  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatRepo: Repository<ChatMessage>,
    private readonly cacheService: CacheService,
    private readonly eventBus: EventBusService,
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
}
