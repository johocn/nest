import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Friend, Guild, GuildMember, GuildDonate } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { FriendStatus, GuildRole, DonateType } from '@constants/enums';

export interface DonateResult {
  donation: GuildDonate;
  contributionGained: number;
  newTotal: number;
}

@Injectable()
export class SocialService {
  constructor(
    @InjectRepository(Friend) private readonly friendRepo: Repository<Friend>,
    @InjectRepository(Guild) private readonly guildRepo: Repository<Guild>,
    @InjectRepository(GuildMember)
    private readonly guildMemberRepo: Repository<GuildMember>,
    @InjectRepository(GuildDonate)
    private readonly guildDonateRepo: Repository<GuildDonate>,
    private readonly eventBus: EventBusService,
  ) {}

  // ===== Friends =====

  async applyFriend(playerId: string, friendId: string): Promise<Friend> {
    const existing = await this.friendRepo.findOne({
      where: { playerId, friendId },
    });
    if (existing && existing.status === FriendStatus.ACCEPTED) {
      throw new GameException(ErrorCodes.NOT_FRIEND, '已经是好友');
    }

    const request = this.friendRepo.create({
      playerId,
      friendId,
      status: FriendStatus.PENDING,
    });
    return this.friendRepo.save(request);
  }

  async acceptFriend(playerId: string, friendId: string): Promise<Friend> {
    // The request was created by friendId → playerId
    const request = await this.friendRepo.findOne({
      where: {
        playerId: friendId,
        friendId: playerId,
        status: FriendStatus.PENDING,
      },
    });
    if (!request) {
      throw new GameException(ErrorCodes.NOT_FRIEND, '没有待处理的好友申请');
    }

    request.status = FriendStatus.ACCEPTED;
    const saved = await this.friendRepo.save(request);

    // Create reciprocal record
    const reciprocal = this.friendRepo.create({
      playerId,
      friendId,
      status: FriendStatus.ACCEPTED,
    });
    await this.friendRepo.save(reciprocal);

    this.eventBus.emit(GameEvents.FRIEND_ADDED, { playerId, friendId });

    return saved;
  }

  async getFriendList(playerId: string): Promise<Friend[]> {
    return this.friendRepo.find({
      where: { playerId, status: FriendStatus.ACCEPTED },
      order: { createdAt: 'DESC' },
    });
  }

  async removeFriend(playerId: string, friendId: string): Promise<void> {
    await this.friendRepo.delete({ playerId, friendId });
    await this.friendRepo.delete({ playerId: friendId, friendId: playerId });
  }

  // ===== Guild =====

  async createGuild(leaderId: string, name: string): Promise<Guild> {
    const existing = await this.guildRepo.findOne({ where: { name } });
    if (existing) {
      throw new GameException(ErrorCodes.ALREADY_IN_GUILD, '公会名已存在');
    }

    const existingMember = await this.guildMemberRepo.findOne({
      where: { playerId: leaderId },
    });
    if (existingMember) {
      throw new GameException(ErrorCodes.ALREADY_IN_GUILD, '已在公会中');
    }

    const guild = this.guildRepo.create({
      name,
      leaderId,
      level: 1,
      memberCount: 1,
    });
    const savedGuild = await this.guildRepo.save(guild);

    const leader = this.guildMemberRepo.create({
      guildId: savedGuild.id,
      playerId: leaderId,
      role: GuildRole.LEADER,
      contribution: 0,
    });
    await this.guildMemberRepo.save(leader);

    this.eventBus.emit(GameEvents.GUILD_JOINED, {
      guildId: savedGuild.id,
      playerId: leaderId,
      role: GuildRole.LEADER,
    });

    return savedGuild;
  }

  async joinGuild(playerId: string, guildId: string): Promise<GuildMember> {
    const guild = await this.guildRepo.findOne({ where: { id: guildId } });
    if (!guild) {
      throw new GameException(ErrorCodes.GUILD_PERMISSION_DENIED, '公会不存在');
    }

    const existing = await this.guildMemberRepo.findOne({
      where: { playerId },
    });
    if (existing) {
      throw new GameException(ErrorCodes.ALREADY_IN_GUILD, '已在公会中');
    }

    const member = this.guildMemberRepo.create({
      guildId,
      playerId,
      role: GuildRole.MEMBER,
      contribution: 0,
    });
    const saved = await this.guildMemberRepo.save(member);

    guild.memberCount += 1;
    await this.guildRepo.save(guild);

    this.eventBus.emit(GameEvents.GUILD_JOINED, {
      guildId,
      playerId,
      role: GuildRole.MEMBER,
    });

    return saved;
  }

  async getGuildInfo(guildId: string): Promise<Guild | null> {
    return this.guildRepo.findOne({ where: { id: guildId } });
  }

  async getGuildMembers(guildId: string): Promise<GuildMember[]> {
    return this.guildMemberRepo.find({
      where: { guildId },
      order: { joinedAt: 'ASC' },
    });
  }

  async donateToGuild(
    playerId: string,
    guildId: string,
    donateType: DonateType,
    amount: string,
  ): Promise<DonateResult> {
    const member = await this.guildMemberRepo.findOne({
      where: { playerId, guildId },
    });
    if (!member) {
      throw new GameException(ErrorCodes.GUILD_PERMISSION_DENIED, '不在公会中');
    }

    const contributionGained = Math.floor(parseInt(amount, 10) / 100);
    member.contribution += contributionGained;
    await this.guildMemberRepo.save(member);

    const donation = this.guildDonateRepo.create({
      guildId,
      playerId,
      donateType,
      amount,
      contributionGained,
    });
    const saved = await this.guildDonateRepo.save(donation);

    this.eventBus.emit(GameEvents.GUILD_DONATED, {
      guildId,
      playerId,
      donateType,
      amount,
      contributionGained,
    });

    return {
      donation: saved,
      contributionGained,
      newTotal: member.contribution,
    };
  }

  async getGuilds(
    page: number,
    limit: number,
  ): Promise<{ items: Guild[]; total: number }> {
    const [items, total] = await this.guildRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }
}
