import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Friend } from '@modules/social/entities/friend.entity';
import { FriendStatus } from '@constants/enums';
import { PlayerService } from '@modules/player/player.service';
import { GuandanRecord } from './entities';

/** 段位档位：按段位分（胜场*10 + 累计升级）划分 */
const TIERS: { min: number; title: string }[] = [
  { min: 800, title: '牌圣' },
  { min: 400, title: '牌王' },
  { min: 180, title: '牌师' },
  { min: 60, title: '牌手' },
  { min: 0, title: '牌童' },
];

export function rankTitleOf(score: number): string {
  return TIERS.find((t) => score >= t.min)?.title ?? '牌童';
}

export interface RankRow {
  rank: number;
  playerId: string;
  nickname: string;
  games: number;
  wins: number;
  levelUp: number;
  score: number;
  title: string;
}

@Injectable()
export class GuandanSocialService {
  private readonly logger = new Logger(GuandanSocialService.name);

  constructor(
    @InjectRepository(Friend) private readonly friendRepo: Repository<Friend>,
    @InjectRepository(GuandanRecord)
    private readonly recordRepo: Repository<GuandanRecord>,
    private readonly playerService: PlayerService,
  ) {}

  async nicknameOf(playerId: string): Promise<string> {
    try {
      const p = await this.playerService.getById(playerId);
      return p?.nickname || `玩家${String(playerId).slice(0, 4)}`;
    } catch {
      return `玩家${String(playerId).slice(0, 4)}`;
    }
  }

  /** 好友列表（online 由网关按 socket 在线情况补齐） */
  async friends(playerId: string) {
    try {
      const rows = await this.friendRepo.find({
        where: { playerId, status: FriendStatus.ACCEPTED },
        order: { createdAt: 'DESC' },
      });
      return await Promise.all(
        rows.map(async (f) => ({
          playerId: f.friendId,
          nickname: await this.nicknameOf(f.friendId),
          online: false,
        })),
      );
    } catch (err: any) {
      this.logger.error(`[friends failed] ${playerId}: ${err?.message}`);
      return [];
    }
  }

  async isFriend(a: string, b: string): Promise<boolean> {
    try {
      const row = await this.friendRepo.findOne({
        where: { playerId: a, friendId: b, status: FriendStatus.ACCEPTED },
      });
      return !!row;
    } catch {
      return false;
    }
  }

  /** 段位排行：按段位分聚合 guandan_records */
  async rank(playerId: string, limit = 20) {
    try {
      const n = Math.min(Math.max(Math.floor(limit) || 20, 1), 100);
      const raw = await this.recordRepo
        .createQueryBuilder('r')
        .select('r.player_id', 'playerId')
        .addSelect('COUNT(*)', 'games')
        .addSelect('SUM(CASE WHEN r.is_winner THEN 1 ELSE 0 END)', 'wins')
        .addSelect('COALESCE(SUM(r.level_up), 0)', 'levelUp')
        .groupBy('r.player_id')
        .getRawMany<{
          playerId: string;
          games: string;
          wins: string;
          levelUp: string;
        }>();

      const stats = raw.map((r) => {
        const wins = Number(r.wins ?? 0);
        const levelUp = Number(r.levelUp ?? 0);
        return {
          playerId: String(r.playerId),
          games: Number(r.games ?? 0),
          wins,
          levelUp,
          score: wins * 10 + levelUp,
        };
      });
      stats.sort((a, b) => b.score - a.score || b.wins - a.wins);

      const decorate = async (
        s: (typeof stats)[number],
        rank: number,
      ): Promise<RankRow> => ({
        rank,
        playerId: s.playerId,
        nickname: await this.nicknameOf(s.playerId),
        games: s.games,
        wins: s.wins,
        levelUp: s.levelUp,
        score: s.score,
        title: rankTitleOf(s.score),
      });

      const top = await Promise.all(
        stats.slice(0, n).map((s, i) => decorate(s, i + 1)),
      );

      const myIdx = stats.findIndex((s) => s.playerId === playerId);
      const me = myIdx >= 0 ? await decorate(stats[myIdx], myIdx + 1) : null;
      return { top, me, total: stats.length };
    } catch (err: any) {
      this.logger.error(`[rank failed] ${playerId}: ${err?.message}`);
      return { top: [], me: null, total: 0 };
    }
  }
}
