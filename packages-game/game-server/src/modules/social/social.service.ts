import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Raw, MoreThan } from 'typeorm';
import {
  Friend,
  Guild,
  GuildMember,
  GuildDonate,
  GuildImpeachment,
  GuildBuilding,
  GuildFundLog,
  GuildActivity,
  GuildDiplomacy,
  Intelligence,
  GiftTemplate,
  Kinship,
  PlayerReport,
  PlayerBlock,
} from './entities';
import { CharacterEspionage, CharacterRelationship } from '@modules/character/entities';
import { CharacterService } from '@modules/character/character.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { PlayerService } from '@modules/player/player.service';
import { Player } from '@modules/player/entities/player.entity';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  FriendStatus,
  GuildRole,
  DonateType,
  GuildBuildingType,
  IntelligenceGrade,
  IntelType,
  IntelSourceType,
  IntelStatus,
  CurrencyType,
  RelationshipLevel,
  KinshipType,
  KinshipStatus,
  GuildImpeachmentStatus,
  GuildFundType,
  GuildActivityType,
  GuildActivityStatus,
  GuildDiplomacyRelation,
  GuildShopRewardType,
  ReportTargetType,
  ReportReason,
  ReportStatus,
} from '@constants/enums';
import { CacheService } from '@cache/cache.service';
import { EconomyService } from '@modules/economy/economy.service';

export interface DonateResult {
  donation: GuildDonate;
  contributionGained: number;
  newTotal: number;
}

export interface FriendRecommendation {
  playerId: string;
  name: string;
  level: number;
  score: number;
  reason: string;
}

@Injectable()
export class SocialService {
  private static readonly SPY_COOLDOWN_SECONDS = 600;

  private readonly FRESHNESS_HOURS: Partial<Record<IntelligenceGrade, number>> = {
    [IntelligenceGrade.B]: 48,
    [IntelligenceGrade.A]: 24,
  };

  constructor(
    @InjectRepository(Friend) private readonly friendRepo: Repository<Friend>,
    @InjectRepository(Guild) private readonly guildRepo: Repository<Guild>,
    @InjectRepository(GuildMember)
    private readonly guildMemberRepo: Repository<GuildMember>,
    @InjectRepository(GuildDonate)
    private readonly guildDonateRepo: Repository<GuildDonate>,
    @InjectRepository(GuildImpeachment)
    private readonly impeachmentRepo: Repository<GuildImpeachment>,
    @InjectRepository(GuildBuilding)
    private readonly buildingRepo: Repository<GuildBuilding>,
    @InjectRepository(GuildFundLog)
    private readonly fundLogRepo: Repository<GuildFundLog>,
    @InjectRepository(GuildActivity)
    private readonly activityRepo: Repository<GuildActivity>,
    @InjectRepository(GuildDiplomacy)
    private readonly diplomacyRepo: Repository<GuildDiplomacy>,
    @InjectRepository(Intelligence)
    private readonly intelligenceRepo: Repository<Intelligence>,
    @InjectRepository(GiftTemplate)
    private readonly giftRepo: Repository<GiftTemplate>,
    @InjectRepository(Kinship)
    private readonly kinshipRepo: Repository<Kinship>,
    @InjectRepository(PlayerReport)
    private readonly reportRepo: Repository<PlayerReport>,
    @InjectRepository(PlayerBlock)
    private readonly blockRepo: Repository<PlayerBlock>,
    @InjectRepository(Player)
    private readonly playerRepo: Repository<Player>,
    @InjectRepository(CharacterEspionage)
    private readonly espionageRepo: Repository<CharacterEspionage>,
    private readonly cacheService: CacheService,
    private readonly economyService: EconomyService,
    private readonly characterService: CharacterService,
    private readonly inventoryService: InventoryService,
    private readonly playerService: PlayerService,
    private readonly eventBus: EventBusService,
    @Optional() private readonly random: () => number = Math.random,
  ) {}

  // ===== Friends =====

  async applyFriend(playerId: string, friendId: string): Promise<Friend> {
    const blocked = await this.isBlocked(playerId, friendId);
    if (blocked) {
      throw new GameException(
        ErrorCodes.TARGET_BLOCKED_YOU,
        '对方已将你拉黑，无法申请好友',
      );
    }

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

  // ===== 举报与拉黑（阶段5批1） =====

  async submitReport(
    playerId: string,
    targetType: ReportTargetType,
    targetId: string,
    reason: ReportReason,
    content?: string,
  ): Promise<PlayerReport> {
    if (
      !Object.values(ReportTargetType).includes(targetType) ||
      !Object.values(ReportReason).includes(reason)
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '举报类型或原因非法');
    }
    if (targetType === ReportTargetType.PLAYER && targetId === playerId) {
      throw new GameException(ErrorCodes.REPORT_INVALID_TARGET, '不能举报自己');
    }
    if (targetType === ReportTargetType.PLAYER) {
      const target = await this.playerService.getById(targetId);
      if (!target) {
        throw new GameException(ErrorCodes.REPORT_INVALID_TARGET, '举报目标不存在');
      }
    }
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const dup = await this.reportRepo.findOne({
      where: { reporterId: playerId, targetType, targetId, createdAt: MoreThan(since) },
    });
    if (dup) {
      throw new GameException(ErrorCodes.REPORT_COOLDOWN, '24小时内已举报该目标');
    }
    const record = await this.reportRepo.save(
      this.reportRepo.create({
        reporterId: playerId,
        targetType,
        targetId,
        reason,
        content: content?.trim() || null,
        status: ReportStatus.PENDING,
      }),
    );
    this.eventBus.emit(GameEvents.REPORT_SUBMITTED, {
      reportId: record.id,
      reporterId: playerId,
      targetType,
      targetId,
    });
    return record;
  }

  async blockPlayer(playerId: string, targetId: string): Promise<PlayerBlock> {
    if (playerId === targetId) {
      throw new GameException(ErrorCodes.BLOCK_SELF, '不能拉黑自己');
    }
    const count = await this.blockRepo.count({ where: { playerId } });
    if (count >= 200) {
      throw new GameException(ErrorCodes.BLOCK_LIMIT, '拉黑数量已达上限');
    }
    const existing = await this.blockRepo.findOne({
      where: { playerId, blockedId: targetId },
    });
    if (existing) return existing;
    const record = await this.blockRepo.save(
      this.blockRepo.create({ playerId, blockedId: targetId }),
    );
    this.eventBus.emit(GameEvents.PLAYER_BLOCKED, {
      playerId,
      blockedId: targetId,
    });
    return record;
  }

  async unblockPlayer(playerId: string, targetId: string): Promise<void> {
    await this.blockRepo.delete({ playerId, blockedId: targetId });
  }

  async listBlocks(
    playerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: PlayerBlock[]; total: number }> {
    const [items, total] = await Promise.all([
      this.blockRepo.find({
        where: { playerId },
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.blockRepo.count({ where: { playerId } }),
    ]);
    return { items, total };
  }

  async isBlocked(a: string, b: string): Promise<boolean> {
    const found = await this.blockRepo.findOne({
      where: [
        { playerId: a, blockedId: b },
        { playerId: b, blockedId: a },
      ],
    });
    return Boolean(found);
  }

  // ===== 图谱协同好友推荐（阶段5批1） =====

  async recommendFriends(
    playerId: string,
    limit = 10,
  ): Promise<FriendRecommendation[]> {
    const n = Math.min(Math.max(Math.floor(limit) || 10, 1), 20);
    const now = Date.now();
    const day7 = new Date(now - 7 * 86400000);

    const [allFriends, allKinships, allGuildMembers, allPlayers, blocks] =
      await Promise.all([
        this.friendRepo.find({ where: { status: FriendStatus.ACCEPTED } }),
        this.kinshipRepo.find({ where: { status: KinshipStatus.ACTIVE } }),
        this.guildMemberRepo.find(),
        this.playerRepo.find(),
        this.blockRepo.find(),
      ]);

    const me = allPlayers.find((p) => p.id === playerId);
    if (!me) return [];

    // 我的好友集合（双向）
    const myFriendIds = new Set<string>();
    for (const f of allFriends) {
      if (f.playerId === playerId) myFriendIds.add(f.friendId);
      if (f.friendId === playerId) myFriendIds.add(f.playerId);
    }
    // 我的帮派集合
    const myGuildIds = new Set(
      allGuildMembers
        .filter((g) => g.playerId === playerId)
        .map((g) => g.guildId),
    );
    // 我的亲缘成员集合（仅我作为 leader 的亲缘）
    const myKinshipIds = new Set<string>();
    for (const k of allKinships) {
      if (k.leaderId === playerId) {
        const members = Array.isArray(k.members) ? k.members : [];
        members.forEach((m) => m !== playerId && myKinshipIds.add(m));
      }
    }
    // 候选排除集：自己 / 好友 / 拉黑
    const blockedSet = new Set<string>();
    for (const b of blocks) {
      if (b.playerId === playerId) blockedSet.add(b.blockedId);
      if (b.blockedId === playerId) blockedSet.add(b.playerId);
    }
    const exclude = new Set<string>([playerId, ...myFriendIds, ...blockedSet]);

    // 玩家帮派全量（同帮派加分用）
    const playerGuild = new Map<string, Set<string>>();
    for (const g of allGuildMembers) {
      if (!playerGuild.has(g.playerId)) playerGuild.set(g.playerId, new Set());
      playerGuild.get(g.playerId)!.add(g.guildId);
    }

    // 全量好友邻接表（候选共同好友计算用，避免逐候选查库）
    const adjacency = new Map<string, Set<string>>();
    for (const f of allFriends) {
      if (!adjacency.has(f.playerId)) adjacency.set(f.playerId, new Set());
      if (!adjacency.has(f.friendId)) adjacency.set(f.friendId, new Set());
      adjacency.get(f.playerId)!.add(f.friendId);
      adjacency.get(f.friendId)!.add(f.playerId);
    }

    const scored: FriendRecommendation[] = [];
    for (const c of allPlayers) {
      if (exclude.has(c.id)) continue;
      const cFriends = adjacency.get(c.id) ?? new Set<string>();
      let common = 0;
      for (const f of cFriends) if (myFriendIds.has(f)) common++;
      let score = 0;
      const reasons: string[] = [];
      if (common > 0) {
        score += common * 3;
        reasons.push(`共同好友${common}人`);
      }
      const guilds = playerGuild.get(c.id);
      if (guilds && [...guilds].some((g) => myGuildIds.has(g))) {
        score += 2;
        reasons.push('同帮派');
      }
      let kinshipCommon = 0;
      for (const f of cFriends) if (myKinshipIds.has(f)) kinshipCommon++;
      if (kinshipCommon > 0) {
        score += kinshipCommon * 1.5;
        reasons.push('亲缘网络');
      }
      if (c.lastActivityAt && c.lastActivityAt >= day7) {
        score += 1;
        reasons.push('活跃玩家');
      }
      if (Math.abs(c.level - me.level) <= 5) score += 0.5;
      if (score > 0) {
        scored.push({
          playerId: c.id,
          name: c.nickname,
          level: c.level,
          score: Math.round(score * 10) / 10,
          reason: reasons.join('、'),
        });
      }
    }

    scored.sort((a, b) => b.score - a.score || this.random() - this.random());
    return scored.slice(0, n);
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

  /** 查询玩家所在公会与职位（无公会返回 null）。 */
  async getMyGuildRole(
    playerId: string,
  ): Promise<{ guildId: string; role: GuildRole } | null> {
    const member = await this.guildMemberRepo.findOne({
      where: { playerId },
    });
    return member ? { guildId: member.guildId, role: member.role } : null;
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

    if (donateType === DonateType.GOLD) {
      const guild = await this.getGuildOrThrow(guildId);
      guild.fund = (BigInt(guild.fund ?? '0') + BigInt(amount)).toString();
      await this.guildRepo.save(guild);
      this.eventBus.emit(GameEvents.GUILD_FUND_CHANGED, {
        guildId,
        amount: parseInt(amount, 10),
        reason: 'guild_donate',
        balance: guild.fund,
      });
    }

    if (contributionGained > 0) {
      await this.economyService.addCurrency(
        playerId,
        CurrencyType.GUILD_CONTRIB,
        contributionGained,
        'guild_donate',
        'social.donateToGuild',
      );
      this.eventBus.emit(GameEvents.GUILD_CONTRIB_GAINED, {
        guildId,
        playerId,
        amount: contributionGained,
      });
    }

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

  // ===== Guild Governance =====

  private static readonly GUILD_ROLE_RANKS: Record<string, number> = {
    [GuildRole.LEADER]: 4,
    [GuildRole.VICE_LEADER]: 3,
    [GuildRole.HALL_MASTER]: 2,
    [GuildRole.INCENSE_MASTER]: 1,
    [GuildRole.OFFICER]: 0,
    [GuildRole.ELITE]: 0,
    [GuildRole.MEMBER]: 0,
  };

  private guildRoleRank(role: GuildRole): number {
    return SocialService.GUILD_ROLE_RANKS[role] ?? 0;
  }

  private async getGuildMemberOrThrow(
    playerId: string,
    guildId: string,
  ): Promise<GuildMember> {
    const member = await this.guildMemberRepo.findOne({
      where: { playerId, guildId },
    });
    if (!member) {
      throw new GameException(ErrorCodes.GUILD_PERMISSION_DENIED, '不在公会中');
    }
    return member;
  }

  private async appendGuildLog(
    guild: Guild,
    type: string,
    playerId: string,
    detail: string,
  ): Promise<void> {
    guild.actionLog = [
      ...(Array.isArray(guild.actionLog) ? guild.actionLog : []),
      { type, playerId, detail, at: new Date(Date.now()).toISOString() },
    ];
    await this.guildRepo.save(guild);
  }

  async setGuildRole(
    operatorId: string,
    guildId: string,
    playerId: string,
    role: GuildRole,
  ): Promise<GuildMember> {
    const operator = await this.getGuildMemberOrThrow(operatorId, guildId);
    if (role === GuildRole.LEADER) {
      throw new GameException(ErrorCodes.GUILD_ROLE_FORBIDDEN, '帮主不可直接任命');
    }
    const maxAppointRank =
      operator.role === GuildRole.LEADER
        ? this.guildRoleRank(GuildRole.VICE_LEADER)
        : operator.role === GuildRole.VICE_LEADER
          ? this.guildRoleRank(GuildRole.HALL_MASTER)
          : -1;
    if (this.guildRoleRank(role) > maxAppointRank) {
      throw new GameException(ErrorCodes.GUILD_ROLE_FORBIDDEN, '无权任命该职位');
    }

    const target = await this.getGuildMemberOrThrow(playerId, guildId);
    target.role = role;
    const saved = await this.guildMemberRepo.save(target);
    await this.appendGuildLog(
      await this.guildRepo.findOneOrFail({ where: { id: guildId } }),
      'role_change',
      operatorId,
      `${playerId} → ${role}`,
    );
    this.eventBus.emit(GameEvents.GUILD_ROLE_CHANGED, {
      guildId,
      playerId,
      role,
      operatorId,
    });
    return saved;
  }

  async initiateImpeachment(
    operatorId: string,
    guildId: string,
  ): Promise<GuildImpeachment> {
    const operator = await this.getGuildMemberOrThrow(operatorId, guildId);
    if (this.guildRoleRank(operator.role) < this.guildRoleRank(GuildRole.VICE_LEADER)) {
      throw new GameException(ErrorCodes.GUILD_ROLE_FORBIDDEN, '仅副帮主以上可发起弹劾');
    }

    const guild = await this.guildRepo.findOne({ where: { id: guildId } });
    if (!guild) {
      throw new GameException(ErrorCodes.GUILD_PERMISSION_DENIED, '公会不存在');
    }

    const leader = await this.playerService.getById(guild.leaderId);
    const lastActive = leader?.lastActivityAt;
    if (lastActive && lastActive.getTime() > Date.now() - 7 * 24 * 3600 * 1000) {
      throw new GameException(ErrorCodes.GUILD_IMPEACHMENT_NOT_READY, '帮主近期在线不可弹劾');
    }

    const pending = await this.impeachmentRepo.findOne({
      where: { guildId, status: GuildImpeachmentStatus.PENDING },
    });
    if (pending) {
      throw new GameException(ErrorCodes.GUILD_IMPEACHMENT_EXISTS, '已有进行中的弹劾');
    }

    const impeachment = this.impeachmentRepo.create({
      guildId,
      targetId: guild.leaderId,
      initiatorId: operatorId,
      endorsements: [],
      status: GuildImpeachmentStatus.PENDING,
      endedAt: null,
    });
    return this.impeachmentRepo.save(impeachment);
  }

  async endorseImpeachment(
    playerId: string,
    impeachmentId: string,
  ): Promise<GuildImpeachment> {
    const impeachment = await this.impeachmentRepo.findOne({
      where: { id: impeachmentId, status: GuildImpeachmentStatus.PENDING },
    });
    if (!impeachment) {
      throw new GameException(ErrorCodes.GUILD_IMPEACHMENT_NOT_READY, '弹劾不存在或已结束');
    }

    const member = await this.getGuildMemberOrThrow(playerId, impeachment.guildId);
    if (this.guildRoleRank(member.role) < this.guildRoleRank(GuildRole.HALL_MASTER)) {
      throw new GameException(ErrorCodes.GUILD_ROLE_FORBIDDEN, '仅香主以上可联署弹劾');
    }

    const endorsements = Array.isArray(impeachment.endorsements)
      ? [...impeachment.endorsements]
      : [];
    if (!endorsements.includes(playerId)) {
      endorsements.push(playerId);
    }
    impeachment.endorsements = endorsements;

    const eligible = await this.guildMemberRepo.find({
      where: { guildId: impeachment.guildId },
    });
    const eligibleCount = eligible.filter(
      (m) =>
        this.guildRoleRank(m.role) >= this.guildRoleRank(GuildRole.HALL_MASTER),
    ).length;
    const quorum = Math.ceil(eligibleCount / 2);
    if (endorsements.length >= quorum) {
      const viceLeader = eligible
        .filter((m) => m.role === GuildRole.VICE_LEADER)
        .sort((a, b) => b.contribution - a.contribution)[0];
      const newLeaderId = viceLeader?.playerId ?? impeachment.initiatorId;
      const guild = await this.guildRepo.findOne({
        where: { id: impeachment.guildId },
      });
      if (guild) {
        guild.leaderId = newLeaderId;
        await this.appendGuildLog(guild, 'impeach', playerId, `弹劾成功，帮主移交 ${newLeaderId}`);
      }
      impeachment.status = GuildImpeachmentStatus.DONE;
      impeachment.endedAt = new Date();
      this.eventBus.emit(GameEvents.GUILD_IMPEACHMENT, {
        guildId: impeachment.guildId,
        impeachmentId,
        newLeaderId,
      });
    }
    return this.impeachmentRepo.save(impeachment);
  }

  async getImpeachment(guildId: string): Promise<GuildImpeachment | null> {
    return this.impeachmentRepo.findOne({
      where: { guildId, status: GuildImpeachmentStatus.PENDING },
    });
  }

  async getGuildLog(guildId: string): Promise<Guild['actionLog']> {
    const guild = await this.guildRepo.findOne({ where: { id: guildId } });
    return guild ? (guild.actionLog ?? []) : [];
  }

  // ===== Guild Base & Fund =====

  private static readonly BUILDING_MAX_LEVEL = 5;
  private static readonly BUILDING_COST_PER_LEVEL = 10000;

  private async getGuildOrThrow(guildId: string): Promise<Guild> {
    const guild = await this.guildRepo.findOne({ where: { id: guildId } });
    if (!guild) {
      throw new GameException(ErrorCodes.GUILD_PERMISSION_DENIED, '公会不存在');
    }
    return guild;
  }

  private async adjustGuildFundInternal(
    operatorId: string,
    guildId: string,
    amount: number,
    reason: string,
  ): Promise<GuildFundLog> {
    const guild = await this.getGuildOrThrow(guildId);
    const operator = await this.getGuildMemberOrThrow(operatorId, guildId);
    if (
      operator.role !== GuildRole.LEADER &&
      operator.role !== GuildRole.VICE_LEADER
    ) {
      throw new GameException(ErrorCodes.GUILD_ROLE_FORBIDDEN, '仅帮主/副帮主可操作资金');
    }

    const current = BigInt(guild.fund ?? '0');
    if (amount < 0 && current + BigInt(amount) < BigInt(0)) {
      throw new GameException(ErrorCodes.GUILD_FUND_NOT_ENOUGH, '帮派资金不足');
    }

    const type = amount >= 0 ? GuildFundType.INCOME : GuildFundType.EXPENSE;
    guild.fund = (current + BigInt(amount)).toString();
    await this.guildRepo.save(guild);

    const log = this.fundLogRepo.create({
      guildId,
      playerId: operatorId,
      amount: Math.abs(amount).toString(),
      type,
      reason,
    });
    const saved = await this.fundLogRepo.save(log);

    this.eventBus.emit(GameEvents.GUILD_FUND_CHANGED, {
      guildId,
      amount,
      reason,
      balance: guild.fund,
    });
    return saved;
  }

  async buildBuilding(
    operatorId: string,
    guildId: string,
    buildingType: GuildBuildingType,
  ): Promise<GuildBuilding> {
    const operator = await this.getGuildMemberOrThrow(operatorId, guildId);
    if (
      operator.role !== GuildRole.LEADER &&
      operator.role !== GuildRole.VICE_LEADER
    ) {
      throw new GameException(ErrorCodes.GUILD_ROLE_FORBIDDEN, '仅帮主/副帮主可建设');
    }

    const existing = await this.buildingRepo.findOne({
      where: { guildId, buildingType },
    });
    const targetLevel = existing ? existing.level + 1 : 1;
    if (targetLevel > SocialService.BUILDING_MAX_LEVEL) {
      throw new GameException(ErrorCodes.GUILD_BUILDING_LEVEL_CAP, '建筑已达最高等级');
    }

    const cost = targetLevel * SocialService.BUILDING_COST_PER_LEVEL;
    await this.adjustGuildFundInternal(
      operatorId,
      guildId,
      -cost,
      `建设${buildingType}至Lv${targetLevel}`,
    );

    if (existing) {
      existing.level = targetLevel;
      return this.buildingRepo.save(existing);
    }
    const building = this.buildingRepo.create({
      guildId,
      buildingType,
      level: 1,
    });
    return this.buildingRepo.save(building);
  }

  async getGuildBuildings(guildId: string): Promise<GuildBuilding[]> {
    return this.buildingRepo.find({
      where: { guildId },
      order: { buildingType: 'ASC' },
    });
  }

  async adjustGuildFund(
    operatorId: string,
    guildId: string,
    amount: number,
    reason: string,
  ): Promise<GuildFundLog> {
    return this.adjustGuildFundInternal(operatorId, guildId, amount, reason);
  }

  async getGuildFundLogs(
    guildId: string,
    page: number,
    limit: number,
  ): Promise<{ items: GuildFundLog[]; total: number }> {
    const [items, total] = await this.fundLogRepo.findAndCount({
      where: { guildId },
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  // ===== Guild Activity & Diplomacy =====

  private async requireGuildLeaderOrVice(
    operatorId: string,
    guildId: string,
  ): Promise<GuildMember> {
    const operator = await this.getGuildMemberOrThrow(operatorId, guildId);
    if (
      operator.role !== GuildRole.LEADER &&
      operator.role !== GuildRole.VICE_LEADER
    ) {
      throw new GameException(ErrorCodes.GUILD_ROLE_FORBIDDEN, '仅帮主/副帮主可操作');
    }
    return operator;
  }

  async createGuildActivity(
    operatorId: string,
    guildId: string,
    activityType: GuildActivityType,
    scheduleAt: Date,
  ): Promise<GuildActivity> {
    await this.requireGuildLeaderOrVice(operatorId, guildId);
    const activity = this.activityRepo.create({
      guildId,
      activityType,
      scheduleAt,
      status: GuildActivityStatus.SCHEDULED,
    });
    return this.activityRepo.save(activity);
  }

  async getGuildActivities(
    guildId: string,
  ): Promise<GuildActivity[]> {
    return this.activityRepo.find({
      where: { guildId },
      order: { scheduleAt: 'ASC' },
    });
  }

  async setDiplomacy(
    operatorId: string,
    guildId: string,
    targetGuildId: string,
    relation: GuildDiplomacyRelation,
  ): Promise<GuildDiplomacy> {
    await this.requireGuildLeaderOrVice(operatorId, guildId);
    const [guild, target] = await Promise.all([
      this.getGuildOrThrow(guildId),
      this.getGuildOrThrow(targetGuildId),
    ]);
    if (guild.id === target.id) {
      throw new GameException(ErrorCodes.GUILD_DIPLOMACY_EXISTS, '不能与自身建立外交');
    }

    const existing = await this.diplomacyRepo.findOne({
      where: { guildId, targetGuildId },
    });
    if (existing) {
      existing.relation = relation;
      const saved = await this.diplomacyRepo.save(existing);
      this.eventBus.emit(GameEvents.GUILD_DIPLOMACY_CHANGED, {
        guildId,
        targetGuildId,
        relation,
      });
      return saved;
    }

    const diplomacy = this.diplomacyRepo.create({
      guildId,
      targetGuildId,
      relation,
      reputation: 0,
    });
    const saved = await this.diplomacyRepo.save(diplomacy);
    this.eventBus.emit(GameEvents.GUILD_DIPLOMACY_CHANGED, {
      guildId,
      targetGuildId,
      relation,
    });
    return saved;
  }

  async getGuildDiplomacies(
    guildId: string,
  ): Promise<GuildDiplomacy[]> {
    return this.diplomacyRepo.find({
      where: { guildId },
      order: { updatedAt: 'DESC' },
    });
  }

  // ===== Guild Shop & Salary =====

  private static readonly SHOP_PRICES: Record<GuildShopRewardType, number> = {
    [GuildShopRewardType.SKILL_POINT]: 100,
    [GuildShopRewardType.RESOURCE_PACK]: 50,
    [GuildShopRewardType.TITLE]: 200,
  };

  private static readonly SALARY_BY_ROLE: Record<string, number> = {
    [GuildRole.LEADER]: 5000,
    [GuildRole.VICE_LEADER]: 3000,
    [GuildRole.HALL_MASTER]: 2000,
    [GuildRole.INCENSE_MASTER]: 1000,
    [GuildRole.MEMBER]: 500,
    [GuildRole.OFFICER]: 500,
    [GuildRole.ELITE]: 500,
  };

  async exchangeGuildShop(
    contributorId: string,
    guildId: string,
    rewardType: GuildShopRewardType,
  ): Promise<{ rewardType: GuildShopRewardType; cost: number; balanceAfter: string }> {
    await this.getGuildMemberOrThrow(contributorId, guildId);
    const cost = SocialService.SHOP_PRICES[rewardType] ?? 50;
    const { balanceAfter } = await this.economyService.deductCurrency(
      contributorId,
      CurrencyType.GUILD_CONTRIB,
      cost,
      'guild_shop',
      'social.exchangeGuildShop',
    );
    return { rewardType, cost, balanceAfter };
  }

  async paySalaries(
    operatorId: string,
    guildId: string,
  ): Promise<{ paid: Array<{ playerId: string; amount: number }>; total: number }> {
    await this.requireGuildLeaderOrVice(operatorId, guildId);
    const guild = await this.getGuildOrThrow(guildId);
    const members = await this.guildMemberRepo.find({ where: { guildId } });

    const paid: Array<{ playerId: string; amount: number }> = [];
    for (const member of members) {
      const player = await this.playerService.getById(member.playerId);
      const lastActive = player?.lastActivityAt;
      if (!lastActive || lastActive.getTime() <= Date.now() - 7 * 24 * 3600 * 1000) {
        continue;
      }
      const salary = SocialService.SALARY_BY_ROLE[member.role] ?? 500;
      if (salary <= 0) {
        continue;
      }
      paid.push({ playerId: member.playerId, amount: salary });
    }

    const total = paid.reduce((sum, p) => sum + p.amount, 0);
    const fund = BigInt(guild.fund ?? '0');
    if (fund < BigInt(total)) {
      throw new GameException(ErrorCodes.GUILD_FUND_NOT_ENOUGH, '帮派资金不足支付周薪');
    }

    for (const p of paid) {
      await this.economyService.addCurrency(
        p.playerId,
        CurrencyType.GOLD,
        p.amount,
        'guild_salary',
        'social.paySalaries',
      );
    }

    guild.fund = (fund - BigInt(total)).toString();
    await this.guildRepo.save(guild);
    const log = this.fundLogRepo.create({
      guildId,
      playerId: operatorId,
      amount: total.toString(),
      type: GuildFundType.EXPENSE,
      reason: 'guild_salary',
    });
    await this.fundLogRepo.save(log);
    this.eventBus.emit(GameEvents.GUILD_FUND_CHANGED, {
      guildId,
      amount: -total,
      reason: 'guild_salary',
      balance: guild.fund,
    });

    return { paid, total };
  }

  async getGuildContributionRank(
    guildId: string,
  ): Promise<GuildMember[]> {
    return this.guildMemberRepo.find({
      where: { guildId },
      order: { contribution: 'DESC' },
    });
  }

  // ===== Intelligence =====

  /**
   * 刺探：成功率 = 60 + 谍报等级*3 - 目标反谍等级*3。
   * espionage 记录查不到时按 espionageLevel=0 处理（不自动创建）。
   */
  async spyIntelligence(
    playerId: string,
    targetId: string,
  ): Promise<Intelligence> {
    const cooldownKey = `intel:spy:${playerId}`;
    const cooldown = await this.cacheService.get(cooldownKey);
    if (cooldown) {
      throw new GameException(ErrorCodes.INTEL_COOLDOWN, '刺探冷却中');
    }

    const [spyRecord, targetRecord] = await Promise.all([
      this.espionageRepo.findOne({ where: { characterId: playerId } }),
      this.espionageRepo.findOne({ where: { characterId: targetId } }),
    ]);
    const espionageLevel = spyRecord?.espionageLevel ?? 0;
    const targetCounterSpyLevel = targetRecord?.counterSpyLevel ?? 0;

    const successRate =
      60 + espionageLevel * 3 - targetCounterSpyLevel * 3;
    if (this.random() * 100 >= successRate) {
      throw new GameException(ErrorCodes.INTEL_SPY_FAILED, '刺探失败');
    }

    const intel = await this.intelligenceRepo.save(
      this.intelligenceRepo.create({
        ownerId: playerId,
        grade:
          this.random() < 0.5 ? IntelligenceGrade.D : IntelligenceGrade.C,
        intelType: IntelType.RUMOR,
        title: '刺探情报',
        content: `来自目标${targetId}的传闻`,
        sourceType: IntelSourceType.SPY,
        sourceId: targetId,
        freshnessExpireAt: this.freshnessExpiry(IntelligenceGrade.B),
        status: IntelStatus.ACTIVE,
        isListed: false,
      }),
    );

    if (spyRecord) {
      spyRecord.intelligenceValue += 10;
      await this.applyEspionageLevelUp(spyRecord);
      await this.espionageRepo.save(spyRecord);
    }

    await this.cacheService.set(
      cooldownKey,
      '1',
      SocialService.SPY_COOLDOWN_SECONDS,
    );

    this.eventBus.emit(GameEvents.INTEL_GAINED, {
      playerId,
      intelId: intel.id,
      grade: intel.grade,
      sourceType: IntelSourceType.SPY,
    });
    return intel;
  }

  /** 打听：花费 100 金币获取 D 级情报。 */
  async inquireIntelligence(
    playerId: string,
    topic: string,
  ): Promise<Intelligence> {
    await this.economyService.deductCurrency(
      playerId,
      CurrencyType.GOLD,
      100,
      'inquire',
      'intel_inquire',
    );

    const intel = await this.intelligenceRepo.save(
      this.intelligenceRepo.create({
        ownerId: playerId,
        grade: IntelligenceGrade.D,
        intelType: IntelType.RUMOR,
        title: `打听：${topic}`,
        content: topic,
        sourceType: IntelSourceType.INQUIRE,
        status: IntelStatus.ACTIVE,
        isListed: false,
      }),
    );

    const espionageRecord = await this.espionageRepo.findOne({
      where: { characterId: playerId },
    });
    if (espionageRecord) {
      espionageRecord.intelligenceValue += 5;
      await this.applyEspionageLevelUp(espionageRecord);
      await this.espionageRepo.save(espionageRecord);
    }

    this.eventBus.emit(GameEvents.INTEL_GAINED, {
      playerId,
      intelId: intel.id,
      grade: intel.grade,
      sourceType: IntelSourceType.INQUIRE,
    });
    return intel;
  }

  /** 窃听：谍报等级 >= 5 且可渗透，产出 B 级机密。 */
  async eavesdropIntelligence(
    playerId: string,
    targetId: string,
  ): Promise<Intelligence> {
    const espionageRecord = await this.espionageRepo.findOne({
      where: { characterId: playerId },
    });
    if (
      !espionageRecord ||
      espionageRecord.espionageLevel < 5 ||
      !espionageRecord.canInfiltrate
    ) {
      throw new GameException(ErrorCodes.INTEL_LEVEL_NOT_ENOUGH, '谍报等级不足');
    }

    const intel = await this.intelligenceRepo.save(
      this.intelligenceRepo.create({
        ownerId: playerId,
        grade: IntelligenceGrade.B,
        intelType: IntelType.SECRET,
        title: '窃听情报',
        content: `来自目标${targetId}的机密`,
        sourceType: IntelSourceType.EAVESDROP,
        sourceId: targetId,
        freshnessExpireAt: this.freshnessExpiry(IntelligenceGrade.B),
        status: IntelStatus.ACTIVE,
        isListed: false,
      }),
    );

    espionageRecord.intelligenceValue += 20;
    await this.applyEspionageLevelUp(espionageRecord);
    await this.espionageRepo.save(espionageRecord);

    this.eventBus.emit(GameEvents.INTEL_GAINED, {
      playerId,
      intelId: intel.id,
      grade: intel.grade,
      sourceType: IntelSourceType.EAVESDROP,
    });
    return intel;
  }

  /** 查询持有情报，懒校验保鲜期（B/A 级过期置为 EXPIRED）。 */
  async getIntelligences(playerId: string): Promise<Intelligence[]> {
    const items = await this.intelligenceRepo.find({
      where: { ownerId: playerId },
      order: { createdAt: 'DESC' },
    });

    const now = new Date();
    const toExpire = items.filter(
      (it) =>
        this.FRESHNESS_HOURS[it.grade] !== undefined &&
        it.freshnessExpireAt !== null &&
        it.freshnessExpireAt < now &&
        it.status === IntelStatus.ACTIVE,
    );
    if (toExpire.length > 0) {
      toExpire.forEach((it) => {
        it.status = IntelStatus.EXPIRED;
      });
      await this.intelligenceRepo.save(toExpire);
    }
    return items;
  }

  /** 挂单出售。 */
  async listIntelligence(
    playerId: string,
    intelId: string,
    price: number,
  ): Promise<Intelligence> {
    const intel = await this.intelligenceRepo.findOne({
      where: { id: intelId, ownerId: playerId },
    });
    if (!intel) {
      throw new GameException(ErrorCodes.INTEL_NOT_FOUND, '情报不存在');
    }
    if (intel.isListed) {
      throw new GameException(ErrorCodes.INTEL_ALREADY_LISTED, '已挂单');
    }
    if (intel.status !== IntelStatus.ACTIVE) {
      throw new GameException(ErrorCodes.INTEL_EXPIRED, '情报已失效');
    }

    intel.isListed = true;
    intel.price = String(price);
    intel.status = IntelStatus.LISTED;
    return this.intelligenceRepo.save(intel);
  }

  /** 情报市场分页列表。 */
  async getIntelMarket(
    page: number,
    limit: number,
  ): Promise<{ items: Intelligence[]; total: number }> {
    const [items, total] = await this.intelligenceRepo.findAndCount({
      where: { isListed: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  /** 购买情报：买家扣款、卖家收款、转移归属并留痕。 */
  async buyIntelligence(
    buyerId: string,
    intelId: string,
  ): Promise<Intelligence> {
    const intel = await this.intelligenceRepo.findOne({
      where: { id: intelId },
    });
    if (!intel || intel.status !== IntelStatus.LISTED) {
      throw new GameException(ErrorCodes.INTEL_NOT_FOUND, '情报不可购买');
    }
    if (buyerId === intel.ownerId) {
      throw new GameException(ErrorCodes.INTEL_NOT_FOUND, '不能购买自己的情报');
    }

    const price = parseInt(intel.price ?? '0', 10);
    const sellerId = intel.ownerId;

    await this.economyService.deductCurrency(
      buyerId,
      CurrencyType.GOLD,
      price,
      'intel_buy',
      'intel_market',
    );
    await this.economyService.addCurrency(
      sellerId,
      CurrencyType.GOLD,
      price,
      'intel_sale',
      'intel_market',
    );

    intel.ownerId = buyerId;
    intel.status = IntelStatus.ACTIVE;
    intel.isListed = false;
    intel.price = null;
    intel.sellerTrace = {
      sellerId,
      soldAt: new Date().toISOString(),
      price,
    };
    const saved = await this.intelligenceRepo.save(intel);

    this.eventBus.emit(GameEvents.INTEL_BOUGHT, { playerId: buyerId });
    this.eventBus.emit(GameEvents.INTEL_SOLD, {
      intelId,
      buyerId,
      sellerId,
      price,
    });
    return saved;
  }

  /** 消耗情报（阶段3战斗弱点消费预留）。 */
  async consumeIntelligence(
    playerId: string,
    intelId: string,
  ): Promise<Intelligence> {
    const intel = await this.intelligenceRepo.findOne({
      where: { id: intelId, ownerId: playerId },
    });
    if (!intel) {
      throw new GameException(ErrorCodes.INTEL_NOT_FOUND, '情报不存在');
    }
    intel.status = IntelStatus.CONSUMED;
    return this.intelligenceRepo.save(intel);
  }

  /**
   * 谍报升级：1-5 级每级 100、6-10 级每级 300，封顶 10 级。
   * 返回是否发生升级。
   */
  private async applyEspionageLevelUp(
    record: CharacterEspionage,
  ): Promise<boolean> {
    const need = (lv: number) =>
      lv < 5 ? (lv + 1) * 100 : 100 * 5 + (lv - 4) * 300;
    let upgraded = false;
    while (
      record.espionageLevel < 10 &&
      record.intelligenceValue >= need(record.espionageLevel)
    ) {
      record.espionageLevel += 1;
      upgraded = true;
    }
    return upgraded;
  }

  private freshnessExpiry(grade: IntelligenceGrade): Date {
    const hours = this.FRESHNESS_HOURS[grade] ?? 48;
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  // ===== Gifts =====

  private static readonly GIFT_DAILY_TTL_SECONDS = 86400;
  private static readonly GIFT_RECIPROCATE_TTL_SECONDS = 86400;

  private async deliverGift(
    playerId: string,
    targetId: string,
    itemId: string,
    opTrace: string,
  ): Promise<{ giftWeight: number; relationship: CharacterRelationship }> {
    const template = await this.giftRepo.findOne({ where: { itemId } });
    if (!template) {
      throw new GameException(ErrorCodes.GIFT_NOT_FOUND, '礼物模板不存在');
    }

    const capKey = `gift:send:${playerId}`;
    const sent = parseInt((await this.cacheService.get(capKey)) ?? '0', 10);
    if (sent >= template.dailyCap) {
      throw new GameException(ErrorCodes.GIFT_DAILY_CAP, '今日送礼已达上限');
    }
    await this.cacheService.set(
      capKey,
      String(sent + 1),
      SocialService.GIFT_DAILY_TTL_SECONDS,
    );

    await this.inventoryService.removeItem(playerId, itemId, 1, opTrace);
    const relationship = await this.characterService.increaseFavorability(
      playerId,
      targetId,
      template.giftWeight,
    );
    return { giftWeight: template.giftWeight, relationship };
  }

  async sendGift(
    playerId: string,
    targetId: string,
    itemId: string,
  ): Promise<{ giftWeight: number; favorability: number; level: RelationshipLevel }> {
    const friend = await this.friendRepo.findOne({
      where: { playerId, friendId: targetId, status: FriendStatus.ACCEPTED },
    });
    if (!friend) {
      throw new GameException(ErrorCodes.NOT_FRIEND, '只能给好友送礼');
    }

    const result = await this.deliverGift(playerId, targetId, itemId, 'gift_send');
    await this.cacheService.set(
      `gift:reciprocate:${targetId}:${playerId}`,
      '1',
      SocialService.GIFT_RECIPROCATE_TTL_SECONDS,
    );
    this.eventBus.emit(GameEvents.GIFT_SENT, {
      playerId,
      targetId,
      direction: 'send',
    });
    return {
      giftWeight: result.giftWeight,
      favorability: result.relationship.favorability,
      level: result.relationship.level,
    };
  }

  async reciprocateGift(
    playerId: string,
    targetId: string,
    itemId: string,
  ): Promise<{ giftWeight: number; favorability: number; level: RelationshipLevel }> {
    const windowKey = `gift:reciprocate:${playerId}:${targetId}`;
    const window = await this.cacheService.get(windowKey);
    if (!window) {
      throw new GameException(ErrorCodes.GIFT_RECIPROCATE_EXPIRED, '回礼窗口不存在或已过期');
    }

    const result = await this.deliverGift(playerId, targetId, itemId, 'gift_reciprocate');
    await this.cacheService.del(windowKey);
    this.eventBus.emit(GameEvents.GIFT_SENT, {
      playerId,
      targetId,
      direction: 'reciprocate',
    });
    return {
      giftWeight: result.giftWeight,
      favorability: result.relationship.favorability,
      level: result.relationship.level,
    };
  }

  // ===== Kinship =====

  private static readonly RELATIONSHIP_RANKS: Record<string, number> = {
    [RelationshipLevel.STRANGER]: 0,
    [RelationshipLevel.ACQUAINTANCE]: 1,
    [RelationshipLevel.FRIEND]: 2,
    [RelationshipLevel.CONFIDANT]: 3,
    [RelationshipLevel.SWORN]: 4,
  };

  private async getPlayerLevel(playerId: string): Promise<number> {
    const player = await this.playerService.getById(playerId);
    return player?.level ?? 0;
  }

  private async assertConfidantPair(a: string, b: string): Promise<void> {
    const [ab, ba] = await Promise.all([
      this.characterService.getRelationshipLevel(a, b),
      this.characterService.getRelationshipLevel(b, a),
    ]);
    const rank = (lv: RelationshipLevel) =>
      SocialService.RELATIONSHIP_RANKS[lv] ?? 0;
    if (rank(ab) < 3 || rank(ba) < 3) {
      throw new GameException(
        ErrorCodes.RELATIONSHIP_NOT_ENOUGH,
        '好感度不足，需互为知己以上',
      );
    }
  }

  private async assertNoActiveKinship(participants: string[]): Promise<void> {
    for (const pid of participants) {
      const existing = await this.kinshipRepo.findOne({
        where: {
          status: KinshipStatus.ACTIVE,
          members: Raw((alias) => `${alias} ? :id`, { id: pid }),
        },
      });
      if (existing) {
        throw new GameException(ErrorCodes.KINSHIP_EXISTS, '已存在未解除的亲缘关系');
      }
    }
  }

  async formKinship(
    playerId: string,
    type: KinshipType,
    memberIds: string[],
    name?: string,
  ): Promise<Kinship> {
    const members = [playerId, ...memberIds];

    for (const m of memberIds) {
      const blocked = await this.isBlocked(playerId, m);
      if (blocked) {
        throw new GameException(
          ErrorCodes.TARGET_BLOCKED_YOU,
          '双方存在拉黑关系，无法缔结亲缘',
        );
      }
    }

    const sizeOk =
      type === KinshipType.SWORN
        ? members.length >= 3 && members.length <= 8
        : members.length === 2;
    if (!sizeOk) {
      throw new GameException(ErrorCodes.KINSHIP_SIZE_INVALID, '亲缘人数不符合要求');
    }

    if (type === KinshipType.MASTER) {
      const [masterLevel, apprenticeLevel] = await Promise.all([
        this.getPlayerLevel(playerId),
        this.getPlayerLevel(memberIds[0]),
      ]);
      if (masterLevel < apprenticeLevel + 10) {
        throw new GameException(ErrorCodes.KINSHIP_LEVEL_GAP, '师徒等级差距需≥10级');
      }
    }

    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        await this.assertConfidantPair(members[i], members[j]);
      }
    }

    await this.assertNoActiveKinship(members);

    const kinship = await this.kinshipRepo.save(
      this.kinshipRepo.create({
        type,
        name: name ?? null,
        leaderId: playerId,
        members,
        status: KinshipStatus.ACTIVE,
      }),
    );
    this.eventBus.emit(GameEvents.KINSHIP_FORMED, {
      kinshipId: kinship.id,
      type,
      leaderId: playerId,
      members,
    });
    return kinship;
  }

  async breakKinship(playerId: string, kinshipId: string): Promise<Kinship> {
    const kinship = await this.kinshipRepo.findOne({
      where: { id: kinshipId, status: KinshipStatus.ACTIVE },
    });
    if (!kinship || !kinship.members.includes(playerId)) {
      throw new GameException(ErrorCodes.KINSHIP_NOT_OWNER, '亲缘关系不存在或无权解除');
    }
    kinship.status = KinshipStatus.DISBANDED;
    kinship.disbandedAt = new Date();
    const saved = await this.kinshipRepo.save(kinship);
    this.eventBus.emit(GameEvents.KINSHIP_BROKEN, {
      kinshipId,
      type: kinship.type,
      playerId,
    });
    return saved;
  }

  async getKinships(playerId: string): Promise<Kinship[]> {
    return this.kinshipRepo.find({
      where: {
        status: KinshipStatus.ACTIVE,
        members: Raw((alias) => `${alias} ? :id`, { id: playerId }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  /** 关系总览：好友 + 亲缘 + 好感关系。 */
  async getSocialSummary(playerId: string): Promise<{
    friends: Friend[];
    kinships: Kinship[];
    relationships: CharacterRelationship[];
  }> {
    const [friends, kinships, relationships] = await Promise.all([
      this.getFriendList(playerId),
      this.getKinships(playerId),
      this.characterService.getRelationships(playerId),
    ]);
    return { friends, kinships, relationships };
  }

  // ===== Daily Guide =====

  /** 七日社交引导：按注册第 N 天返回当日任务 + 完成状态。 */
  async getDailyGuide(playerId: string): Promise<{
    day: number;
    title: string;
    tasks: Array<{ id: string; desc: string; done: boolean }>;
    stats: { friends: number; kinships: number; intel: number; inGuild: boolean };
  }> {
    const player = await this.playerService.getById(playerId);
    const createdAt = player?.createdAt ?? new Date();
    const day = Math.min(
      Math.floor((Date.now() - createdAt.getTime()) / (24 * 3600 * 1000)) + 1,
      8,
    );

    const [friends, kinships, intelligences, guildMember] = await Promise.all([
      this.getFriendList(playerId),
      this.getKinships(playerId),
      this.getIntelligences(playerId),
      this.guildMemberRepo.findOne({ where: { playerId } }),
    ]);
    const stats = {
      friends: friends.length,
      kinships: kinships.length,
      intel: intelligences.length,
      inGuild: !!guildMember,
    };

    const guide: Record<
      number,
      { title: string; tasks: Array<{ id: string; desc: string; done: boolean }> }
    > = {
      1: {
        title: '寻师问路',
        tasks: [
          { id: 'kinship', desc: '缔结一段师徒或结义亲缘', done: stats.kinships > 0 },
        ],
      },
      2: {
        title: '以武会友',
        tasks: [
          { id: 'friend', desc: '添加 1 位好友', done: stats.friends > 0 },
        ],
      },
      3: {
        title: '初涉江湖',
        tasks: [
          { id: 'intel', desc: '获取 1 条情报（刺探/打听/窃听）', done: stats.intel > 0 },
        ],
      },
      4: {
        title: '立帮兴业',
        tasks: [
          { id: 'guild', desc: '加入或创建帮派', done: stats.inGuild },
        ],
      },
      5: {
        title: '行商走镖',
        tasks: [
          { id: 'escort', desc: '完成 1 次运镖或悬赏', done: false },
        ],
      },
      6: {
        title: '礼尚往来',
        tasks: [
          { id: 'gift', desc: '送出 1 份礼物并获得回礼', done: false },
        ],
      },
      7: {
        title: '桃园之义',
        tasks: [
          { id: 'sworn', desc: '完成结义或正式拜师', done: stats.kinships > 0 },
        ],
      },
      8: {
        title: '日常循环',
        tasks: [
          { id: 'daily', desc: '每日任务与帮派活动循环', done: false },
        ],
      },
    };

    return { day, ...guide[day]!, stats };
  }

  async graduateApprentice(playerId: string, kinshipId: string): Promise<Kinship> {
    const kinship = await this.kinshipRepo.findOne({
      where: { id: kinshipId, status: KinshipStatus.ACTIVE },
    });
    if (
      !kinship ||
      kinship.type !== KinshipType.MASTER ||
      kinship.leaderId !== playerId
    ) {
      throw new GameException(ErrorCodes.KINSHIP_NOT_OWNER, '仅师父可操作出师');
    }
    const apprenticeId = kinship.members.find((m) => m !== playerId);
    if (!apprenticeId) {
      throw new GameException(ErrorCodes.KINSHIP_SIZE_INVALID, '师徒关系成员异常');
    }
    const [masterLevel, apprenticeLevel] = await Promise.all([
      this.getPlayerLevel(playerId),
      this.getPlayerLevel(apprenticeId),
    ]);
    if (apprenticeLevel < masterLevel) {
      throw new GameException(ErrorCodes.KINSHIP_LEVEL_GAP, '徒弟等级未达标');
    }
    kinship.status = KinshipStatus.DISBANDED;
    kinship.disbandedAt = new Date();
    const saved = await this.kinshipRepo.save(kinship);
    this.eventBus.emit(GameEvents.KINSHIP_BROKEN, {
      kinshipId,
      type: kinship.type,
      playerId,
      reason: 'graduate',
    });
    return saved;
  }
}
