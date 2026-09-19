import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Raw } from 'typeorm';
import {
  Friend,
  Guild,
  GuildMember,
  GuildDonate,
  Intelligence,
  GiftTemplate,
  Kinship,
} from './entities';
import { CharacterEspionage, CharacterRelationship } from '@modules/character/entities';
import { CharacterService } from '@modules/character/character.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { PlayerService } from '@modules/player/player.service';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  FriendStatus,
  GuildRole,
  DonateType,
  IntelligenceGrade,
  IntelType,
  IntelSourceType,
  IntelStatus,
  CurrencyType,
  RelationshipLevel,
  KinshipType,
  KinshipStatus,
} from '@constants/enums';
import { CacheService } from '@cache/cache.service';
import { EconomyService } from '@modules/economy/economy.service';

export interface DonateResult {
  donation: GuildDonate;
  contributionGained: number;
  newTotal: number;
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
    @InjectRepository(Intelligence)
    private readonly intelligenceRepo: Repository<Intelligence>,
    @InjectRepository(GiftTemplate)
    private readonly giftRepo: Repository<GiftTemplate>,
    @InjectRepository(Kinship)
    private readonly kinshipRepo: Repository<Kinship>,
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
