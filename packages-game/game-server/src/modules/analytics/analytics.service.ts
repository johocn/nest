import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PlayerBehaviorLog, RetentionStat } from './entities';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import {
  BehaviorType,
  ChatChannel,
  CurrencyType,
  FriendStatus,
  KinshipStatus,
  StatPeriod,
} from '@constants/enums';
import { Friend } from '@modules/social/entities/friend.entity';
import { Kinship } from '@modules/social/entities/kinship.entity';
import { GuildMember } from '@modules/social/entities/guild-member.entity';
import { Player } from '@modules/player/entities/player.entity';
import { ChatMessage } from '@modules/chat/entities/chat-message.entity';
import { Transaction } from '@modules/economy/entities/transaction.entity';

export interface BehaviorStat {
  behaviorType: string;
  count: number;
}

export interface DashboardSummary {
  dau: number;
  behaviorStats: BehaviorStat[];
  generatedAt: string;
}

export interface SocialGraphNode {
  id: string;
  nickname: string;
  degree: number;
}

export interface SocialGraphEdge {
  source: string;
  target: string;
  type: 'friend' | 'kinship';
}

export interface SocialHub {
  playerId: string;
  nickname: string;
  degree: number;
  friendCount: number;
  kinshipCount: number;
}

export interface ChurnRisk {
  playerId: string;
  nickname: string;
  prevCount: number;
  recentCount: number;
  dropRate: number;
  riskLevel: 'high' | 'medium';
  pushSuggested: boolean;
}

export interface SocialFunnel {
  newPlayerCount: number;
  relatedCount: number;
  relationRate: number;
  threshold: number;
  healthy: boolean;
  detail: { withFriend: number; withGuild: number; withKinship: number };
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(PlayerBehaviorLog)
    private readonly logRepo: Repository<PlayerBehaviorLog>,
    @InjectRepository(RetentionStat)
    private readonly retentionRepo: Repository<RetentionStat>,
    @InjectRepository(Friend)
    private readonly friendRepo: Repository<Friend>,
    @InjectRepository(Kinship)
    private readonly kinshipRepo: Repository<Kinship>,
    @InjectRepository(GuildMember)
    private readonly guildMemberRepo: Repository<GuildMember>,
    @InjectRepository(Player)
    private readonly playerRepo: Repository<Player>,
    @InjectRepository(ChatMessage)
    private readonly chatRepo: Repository<ChatMessage>,
    @InjectRepository(Transaction)
    private readonly txRepo: Repository<Transaction>,
    private readonly eventBus: EventBusService,
  ) {}

  async logBehavior(
    playerId: string,
    behaviorType: BehaviorType,
    detail?: Record<string, any>,
  ): Promise<PlayerBehaviorLog> {
    const log = this.logRepo.create({
      playerId,
      behaviorType,
      detailJson: detail ?? {},
      ipAddress: null,
    });
    const saved = await this.logRepo.save(log);

    this.eventBus.emit(GameEvents.PLAYER_BEHAVIOR, {
      playerId,
      behaviorType,
      detail,
    });

    return saved;
  }

  async getBehaviorStatsFrom(days: number): Promise<BehaviorStat[]> {
    const qb = this.logRepo
      .createQueryBuilder('log')
      .select('log.behaviorType', 'behavior_type')
      .addSelect('COUNT(*)', 'count')
      .where(`log.createdAt >= now() - (:days * interval '1 day')`, { days })
      .groupBy('log.behaviorType')
      .orderBy('count', 'DESC');

    const raw = await qb.getRawMany();
    return raw.map((r: any) => ({
      behaviorType: r.behavior_type,
      count: parseInt(r.count, 10),
    }));
  }

  async getBehaviorStats(
    startDate: Date,
    endDate: Date,
  ): Promise<BehaviorStat[]> {
    const qb = this.logRepo
      .createQueryBuilder('log')
      .select('log.behaviorType', 'behavior_type')
      .addSelect('COUNT(*)', 'count')
      .where('log.createdAt >= :start', { start: startDate })
      .andWhere('log.createdAt <= :end', { end: endDate })
      .groupBy('log.behaviorType')
      .orderBy('count', 'DESC');

    const raw = await qb.getRawMany();
    return raw.map((r: any) => ({
      behaviorType: r.behavior_type,
      count: parseInt(r.count, 10),
    }));
  }

  async getDailyActiveUsers(date: string): Promise<number> {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    const qb = this.logRepo
      .createQueryBuilder('log')
      .select('COUNT(DISTINCT log.playerId)', 'count')
      .where('log.createdAt >= :start', { start: new Date(date) })
      .andWhere('log.createdAt < :end', { end: nextDay });

    const result = await qb.getRawOne();
    return parseInt(result?.count ?? '0', 10);
  }

  async calculateRetention(
    cohortDate: string,
    statDate: string,
    period: StatPeriod,
  ): Promise<RetentionStat> {
    const cohortNext = new Date(cohortDate);
    cohortNext.setDate(cohortNext.getDate() + 1);
    const statNext = new Date(statDate);
    statNext.setDate(statNext.getDate() + 1);

    // Count cohort size (new users on cohort date)
    const cohortQb = this.logRepo
      .createQueryBuilder('log')
      .select('COUNT(DISTINCT log.playerId)', 'count')
      .where('log.behaviorType = :type', { type: BehaviorType.LOGIN })
      .andWhere('log.createdAt >= :start', { start: new Date(cohortDate) })
      .andWhere('log.createdAt < :end', { end: cohortNext });
    const cohortResult = await cohortQb.getRawOne();
    const cohortSize = parseInt(cohortResult?.count ?? '0', 10);

    // Count retained users (logged in on stat date AND on cohort date)
    const retainedQb = this.logRepo
      .createQueryBuilder('log')
      .select('COUNT(DISTINCT log.playerId)', 'count')
      .where('log.behaviorType = :type', { type: BehaviorType.LOGIN })
      .andWhere('log.createdAt >= :start', { start: new Date(statDate) })
      .andWhere('log.createdAt < :end', { end: statNext });
    const retainedResult = await retainedQb.getRawOne();
    const retainedCount = parseInt(retainedResult?.count ?? '0', 10);

    const retentionRate =
      cohortSize > 0
        ? Math.round((retainedCount / cohortSize) * 10000) / 100
        : 0;

    // Upsert retention stat
    let stat = await this.retentionRepo.findOne({
      where: { statDate, cohortDate, period },
    });
    if (!stat) {
      stat = this.retentionRepo.create({ statDate, cohortDate, period });
    }

    stat.cohortSize = cohortSize;
    stat.retainedCount = retainedCount;
    stat.retentionRate = retentionRate;

    return this.retentionRepo.save(stat);
  }

  async getRetentionStats(cohortDate: string): Promise<RetentionStat[]> {
    return this.retentionRepo.find({
      where: { cohortDate },
      order: { statDate: 'ASC' },
    });
  }

  async getDashboard(): Promise<DashboardSummary> {
    const today = new Date().toISOString().slice(0, 10);
    const dau = await this.getDailyActiveUsers(today);

    const behaviorStats = await this.getBehaviorStatsFrom(7);

    return {
      dau,
      behaviorStats,
      generatedAt: new Date().toISOString(),
    };
  }

  // ===== 社交数据分析（13.8）=====

  async getSocialGraph(
    limit = 50,
  ): Promise<{ nodes: SocialGraphNode[]; edges: SocialGraphEdge[] }> {
    const day30 = `now() - interval '30 days'`;
    const activeRows = await this.logRepo
      .createQueryBuilder('log')
      .select('DISTINCT log.playerId', 'playerId')
      .where(`log.createdAt >= ${day30}`)
      .getRawMany<{ playerId: string }>();
    const activeIds = activeRows
      .map((r) => r.playerId)
      .filter((id): id is string => Boolean(id));

    const [players, friends, kinships] = await Promise.all([
      activeIds.length
        ? this.playerRepo.find({ where: { id: In(activeIds) } })
        : Promise.resolve([]),
      this.friendRepo.find({ where: { status: FriendStatus.ACCEPTED } }),
      this.kinshipRepo.find({ where: { status: KinshipStatus.ACTIVE } }),
    ]);
    const idSet = new Set(activeIds);
    const nicknameMap = new Map(players.map((p) => [p.id, p.nickname]));

    const friendCount = new Map<string, number>();
    for (const f of friends) {
      if (idSet.has(f.playerId))
        friendCount.set(f.playerId, (friendCount.get(f.playerId) ?? 0) + 1);
      if (idSet.has(f.friendId))
        friendCount.set(f.friendId, (friendCount.get(f.friendId) ?? 0) + 1);
    }
    const kinshipCount = new Map<string, number>();
    for (const k of kinships) {
      const members = Array.isArray(k.members) ? k.members : [];
      for (const m of members) {
        if (idSet.has(m))
          kinshipCount.set(m, (kinshipCount.get(m) ?? 0) + 1);
      }
      if (idSet.has(k.leaderId) && !members.includes(k.leaderId)) {
        kinshipCount.set(k.leaderId, (kinshipCount.get(k.leaderId) ?? 0) + 1);
      }
    }

    const nodes: SocialGraphNode[] = activeIds
      .map((id) => ({
        id,
        nickname: nicknameMap.get(id) ?? '',
        degree: (friendCount.get(id) ?? 0) + (kinshipCount.get(id) ?? 0),
      }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, limit);

    const nodeSet = new Set(nodes.map((n) => n.id));
    const edgeKey = new Set<string>();
    const edges: SocialGraphEdge[] = [];
    for (const f of friends) {
      if (nodeSet.has(f.playerId) && nodeSet.has(f.friendId)) {
        const key = [f.playerId, f.friendId].sort().join(':');
        if (!edgeKey.has(key)) {
          edgeKey.add(key);
          edges.push({ source: f.playerId, target: f.friendId, type: 'friend' });
        }
      }
    }
    for (const k of kinships) {
      const members = Array.isArray(k.members) ? k.members : [];
      if (nodeSet.has(k.leaderId)) {
        for (const m of members) {
          if (m === k.leaderId || !nodeSet.has(m)) continue;
          const key = [k.leaderId, m].sort().join(':');
          if (!edgeKey.has(key)) {
            edgeKey.add(key);
            edges.push({ source: k.leaderId, target: m, type: 'kinship' });
          }
        }
      }
    }
    return { nodes, edges };
  }

  async getSocialHubs(limit = 10): Promise<SocialHub[]> {
    const [friends, kinships] = await Promise.all([
      this.friendRepo.find({ where: { status: FriendStatus.ACCEPTED } }),
      this.kinshipRepo.find({ where: { status: KinshipStatus.ACTIVE } }),
    ]);
    const friendCount = new Map<string, number>();
    for (const f of friends) {
      friendCount.set(f.playerId, (friendCount.get(f.playerId) ?? 0) + 1);
      friendCount.set(f.friendId, (friendCount.get(f.friendId) ?? 0) + 1);
    }
    const kinshipCount = new Map<string, number>();
    for (const k of kinships) {
      const members = Array.isArray(k.members) ? k.members : [];
      for (const m of members) kinshipCount.set(m, (kinshipCount.get(m) ?? 0) + 1);
      if (!members.includes(k.leaderId)) {
        kinshipCount.set(k.leaderId, (kinshipCount.get(k.leaderId) ?? 0) + 1);
      }
    }
    const ids = Array.from(
      new Set([...friendCount.keys(), ...kinshipCount.keys()]),
    );
    if (!ids.length) return [];

    const players = await this.playerRepo.find({ where: { id: In(ids) } });
    const nicknameMap = new Map(players.map((p) => [p.id, p.nickname]));
    return ids
      .map((id) => ({
        playerId: id,
        nickname: nicknameMap.get(id) ?? '',
        degree: (friendCount.get(id) ?? 0) + (kinshipCount.get(id) ?? 0),
        friendCount: friendCount.get(id) ?? 0,
        kinshipCount: kinshipCount.get(id) ?? 0,
      }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, limit);
  }

  async getChurnRisks(days = 7): Promise<ChurnRisk[]> {
    const now = new Date();
    const recentStart = new Date(now.getTime() - days * 86400000);
    const prevStart = new Date(recentStart.getTime() - days * 86400000);

    const [recentActions, prevActions, recentLoginRows] = await Promise.all([
      this.countSocialActionsByPlayer(recentStart, now),
      this.countSocialActionsByPlayer(prevStart, recentStart),
      this.logRepo
        .createQueryBuilder('log')
        .select('DISTINCT log.playerId', 'playerId')
        .where('log.behaviorType = :type', { type: BehaviorType.LOGIN })
        .andWhere('log.createdAt >= :d', { d: recentStart })
        .getRawMany<{ playerId: string }>(),
    ]);
    const loginIds = new Set(
      recentLoginRows.map((r) => r.playerId).filter(Boolean),
    );
    const candidates = Array.from(
      new Set([...recentActions.keys(), ...prevActions.keys()]),
    ).filter((id) => loginIds.has(id));

    const risks: ChurnRisk[] = [];
    for (const id of candidates) {
      const prevCount = prevActions.get(id) ?? 0;
      const recentCount = recentActions.get(id) ?? 0;
      if (prevCount < 3) continue;
      const dropRate = Math.round(((prevCount - recentCount) / prevCount) * 100);
      if (dropRate < 50) continue;
      risks.push({
        playerId: id,
        nickname: '',
        prevCount,
        recentCount,
        dropRate,
        riskLevel: dropRate >= 70 ? 'high' : 'medium',
        pushSuggested: true,
      });
    }
    risks.sort((a, b) => b.dropRate - a.dropRate);

    if (risks.length) {
      const players = await this.playerRepo.find({
        where: { id: In(risks.map((r) => r.playerId)) },
      });
      const nicknameMap = new Map(players.map((p) => [p.id, p.nickname]));
      for (const r of risks) r.nickname = nicknameMap.get(r.playerId) ?? '';
    }
    return risks;
  }

  async getSocialFunnel(days = 7): Promise<SocialFunnel> {
    const newPlayers = await this.playerRepo
      .createQueryBuilder('p')
      .where("p.createdAt >= now() - (:days * interval '1 day')", { days })
      .getMany();
    const ids = newPlayers.map((p) => p.id);
    if (!ids.length) {
      return {
        newPlayerCount: 0,
        relatedCount: 0,
        relationRate: 0,
        threshold: 60,
        healthy: false,
        detail: { withFriend: 0, withGuild: 0, withKinship: 0 },
      };
    }

    const [friends, guildMembers, kinships] = await Promise.all([
      this.friendRepo.find({
        where: [
          { playerId: In(ids), status: FriendStatus.ACCEPTED },
          { friendId: In(ids), status: FriendStatus.ACCEPTED },
        ],
      }),
      this.guildMemberRepo.find({ where: { playerId: In(ids) } }),
      this.kinshipRepo.find({ where: { status: KinshipStatus.ACTIVE } }),
    ]);
    const friendSet = new Set(
      friends.flatMap((f) => [f.playerId, f.friendId]),
    );
    const guildSet = new Set(guildMembers.map((g) => g.playerId));
    const kinshipSet = new Set(
      kinships.flatMap((k) =>
        Array.isArray(k.members) ? [...k.members, k.leaderId] : [k.leaderId],
      ),
    );

    let withFriend = 0;
    let withGuild = 0;
    let withKinship = 0;
    let relatedCount = 0;
    for (const id of ids) {
      const hasFriend = friendSet.has(id);
      const hasGuild = guildSet.has(id);
      const hasKinship = kinshipSet.has(id);
      if (hasFriend) withFriend += 1;
      if (hasGuild) withGuild += 1;
      if (hasKinship) withKinship += 1;
      if (hasFriend || hasGuild || hasKinship) relatedCount += 1;
    }

    const relationRate = Math.round((relatedCount / ids.length) * 1000) / 10;
    return {
      newPlayerCount: ids.length,
      relatedCount,
      relationRate,
      threshold: 60,
      healthy: relationRate >= 60,
      detail: { withFriend, withGuild, withKinship },
    };
  }

  private async countSocialActionsByPlayer(
    start: Date,
    end: Date,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const add = (id: string, n: number) => {
      if (!id) return;
      counts.set(id, (counts.get(id) ?? 0) + n);
    };

    const friendRows = await this.friendRepo
      .createQueryBuilder('f')
      .select('f.player_id', 'playerId')
      .addSelect('f.friend_id', 'friendId')
      .where('f.status = :status', { status: FriendStatus.ACCEPTED })
      .andWhere('f.created_at >= :start', { start })
      .andWhere('f.created_at < :end', { end })
      .getRawMany<{ playerId: string; friendId: string }>();
    for (const r of friendRows) {
      add(r.playerId, 1);
      add(r.friendId, 1);
    }

    const txRows = await this.txRepo
      .createQueryBuilder('t')
      .select('t.player_id', 'playerId')
      .where('t.currency_type = :cur', { cur: CurrencyType.FAVOR })
      .andWhere('t.created_at >= :start', { start })
      .andWhere('t.created_at < :end', { end })
      .getRawMany<{ playerId: string }>();
    for (const r of txRows) add(r.playerId, 1);

    const chatRows = await this.chatRepo
      .createQueryBuilder('c')
      .select('c.sender_id', 'senderId')
      .where('c.channel IN (:...channels)', {
        channels: [ChatChannel.WORLD, ChatChannel.GUILD],
      })
      .andWhere('c.created_at >= :start', { start })
      .andWhere('c.created_at < :end', { end })
      .getRawMany<{ senderId: string }>();
    for (const r of chatRows) add(r.senderId, 1);

    return counts;
  }
}
