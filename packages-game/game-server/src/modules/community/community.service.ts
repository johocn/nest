import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FeedbackSuggestion, PlayerAmbassador } from './entities';
import { PlayerReport } from '@modules/social/entities/player-report.entity';
import {
  AmbassadorStatus,
  FeedbackCategory,
  FeedbackStatus,
  PenaltyLevel,
  ReportHandleAction,
  ReportStatus,
  ReportTargetType,
} from '@constants/enums';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { EventBusService } from '@event-bus/event-bus.service';
import { GameEvents } from '@event-bus/game-events';
import { AdminService } from '@modules/admin/admin.service';
import { AnalyticsService } from '@modules/analytics/analytics.service';
import { AuthService } from '@modules/auth/auth.service';
import { RankingService } from '@modules/ranking/ranking.service';
import { SocialService } from '@modules/social/social.service';
import { Player } from '@modules/player/entities/player.entity';
import {
  Character,
  TitleTemplate,
  CharacterTitle,
} from '@modules/character/entities';

const AMBASSADOR_TITLE_NAME = '江湖大使';

@Injectable()
export class CommunityService {
  constructor(
    @InjectRepository(FeedbackSuggestion)
    private readonly feedbackRepo: Repository<FeedbackSuggestion>,
    @InjectRepository(PlayerAmbassador)
    private readonly ambassadorRepo: Repository<PlayerAmbassador>,
    @InjectRepository(PlayerReport)
    private readonly reportRepo: Repository<PlayerReport>,
    @InjectRepository(Player)
    private readonly playerRepo: Repository<Player>,
    @InjectRepository(Character)
    private readonly charRepo: Repository<Character>,
    @InjectRepository(TitleTemplate)
    private readonly titleRepo: Repository<TitleTemplate>,
    @InjectRepository(CharacterTitle)
    private readonly charTitleRepo: Repository<CharacterTitle>,
    private readonly adminService: AdminService,
    private readonly analyticsService: AnalyticsService,
    private readonly authService: AuthService,
    private readonly eventBus: EventBusService,
    private readonly rankingService: RankingService,
    private readonly socialService: SocialService,
  ) {}

  // ===== 建议箱 =====

  async submitFeedback(
    playerId: string,
    category: FeedbackCategory,
    content: string,
  ): Promise<FeedbackSuggestion> {
    if (
      !Object.values(FeedbackCategory).includes(category) ||
      !content.trim()
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '反馈分类或内容无效');
    }
    const record = await this.feedbackRepo.save(
      this.feedbackRepo.create({
        playerId,
        category,
        content: content.trim(),
        status: FeedbackStatus.PENDING,
      }),
    );
    this.eventBus.emit(GameEvents.FEEDBACK_SUBMITTED, {
      feedbackId: record.id,
      playerId,
      category,
    });
    return record;
  }

  async getMyFeedback(playerId: string): Promise<FeedbackSuggestion[]> {
    return this.feedbackRepo.find({
      where: { playerId },
      order: { createdAt: 'DESC' },
    });
  }

  async listFeedback(
    status?: FeedbackStatus,
    page = 1,
    limit = 20,
  ): Promise<{ items: FeedbackSuggestion[]; total: number }> {
    const where =
      status && Object.values(FeedbackStatus).includes(status)
        ? { status }
        : {};
    const [items, total] = await this.feedbackRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async handleFeedback(
    adminId: string,
    id: string,
    status: FeedbackStatus,
    reply?: string,
  ): Promise<FeedbackSuggestion> {
    if (
      ![FeedbackStatus.ACCEPTED, FeedbackStatus.REJECTED, FeedbackStatus.DONE].includes(
        status,
      )
    ) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '处理状态无效');
    }
    const record = await this.feedbackRepo.findOne({ where: { id } });
    if (!record) {
      throw new GameException(ErrorCodes.FEEDBACK_NOT_FOUND, '反馈不存在');
    }
    if (record.status !== FeedbackStatus.PENDING) {
      throw new GameException(ErrorCodes.FEEDBACK_NOT_FOUND, '该反馈已处理');
    }
    record.status = status;
    record.reply = reply?.trim() || null;
    record.adminId = adminId;
    record.handledAt = new Date();
    const saved = await this.feedbackRepo.save(record);
    await this.adminService.logOperation({
      adminId,
      targetPlayerId: saved.playerId,
      operation: 'community.feedback.handle',
      changeBefore: { id, status: 'pending' },
      changeAfter: { id: saved.id, status: saved.status, reply: saved.reply },
    });
    return saved;
  }

  // ===== 玩家大使 =====

  async appointAmbassador(
    adminId: string,
    playerId: string,
    remark?: string,
  ): Promise<PlayerAmbassador> {
    const existing = await this.ambassadorRepo.findOne({
      where: { playerId, status: AmbassadorStatus.ACTIVE },
    });
    if (existing) {
      throw new GameException(ErrorCodes.AMBASSADOR_EXISTS, '该玩家已是在任大使');
    }
    const record = await this.ambassadorRepo.save(
      this.ambassadorRepo.create({
        playerId,
        status: AmbassadorStatus.ACTIVE,
        remark: remark?.trim() || null,
        createdBy: adminId,
        appointedAt: new Date(),
      }),
    );
    this.eventBus.emit(GameEvents.AMBASSADOR_APPOINTED, {
      ambassadorId: record.id,
      playerId,
    });
    await this.grantAmbassadorTitle(playerId).catch(() => undefined);
    await this.adminService.logOperation({
      adminId,
      targetPlayerId: playerId,
      operation: 'community.ambassador.appoint',
      changeAfter: { id: record.id, status: record.status, remark: record.remark },
    });
    return record;
  }

  async revokeAmbassador(adminId: string, id: string): Promise<PlayerAmbassador> {
    const record = await this.ambassadorRepo.findOne({ where: { id } });
    if (!record) {
      throw new GameException(ErrorCodes.AMBASSADOR_NOT_FOUND, '大使记录不存在');
    }
    if (record.status === AmbassadorStatus.REVOKED) {
      throw new GameException(ErrorCodes.AMBASSADOR_NOT_FOUND, '该大使已撤销');
    }
    record.status = AmbassadorStatus.REVOKED;
    record.revokedAt = new Date();
    const saved = await this.ambassadorRepo.save(record);
    await this.adminService.logOperation({
      adminId,
      targetPlayerId: saved.playerId,
      operation: 'community.ambassador.revoke',
      changeBefore: { id, status: AmbassadorStatus.ACTIVE },
      changeAfter: { id: saved.id, status: saved.status },
    });
    return saved;
  }

  async listAmbassadors(
    status?: AmbassadorStatus,
    page = 1,
    limit = 20,
  ): Promise<{ items: (PlayerAmbassador & { nickname: string })[]; total: number }> {
    const where =
      status && Object.values(AmbassadorStatus).includes(status) ? { status } : {};
    const [items, total] = await this.ambassadorRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { appointedAt: 'DESC' },
    });
    return { items: await this.withNickname(items), total };
  }

  async getActiveAmbassadors(): Promise<
    (PlayerAmbassador & { nickname: string })[]
  > {
    const items = await this.ambassadorRepo.find({
      where: { status: AmbassadorStatus.ACTIVE },
      order: { appointedAt: 'DESC' },
    });
    return this.withNickname(items);
  }

  /** 社交枢纽候选（13.8②，来自 analytics 社交枢纽） */
  async recommendAmbassadors(limit = 10): Promise<unknown[]> {
    return this.analyticsService.getSocialHubs(limit);
  }

  // ===== 举报台账（阶段5批1） =====

  async listReports(
    status?: ReportStatus,
    page = 1,
    limit = 20,
  ): Promise<{ items: PlayerReport[]; total: number }> {
    const [items, total] = await Promise.all([
      this.reportRepo.find({
        where: status ? { status } : {},
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.reportRepo.count({ where: status ? { status } : {} }),
    ]);
    return { items, total };
  }

  async handleReport(
    adminId: string,
    adminName: string,
    reportId: string,
    action: ReportHandleAction,
    remark?: string,
    durationSeconds?: number,
  ): Promise<PlayerReport> {
    const report = await this.reportRepo.findOne({ where: { id: reportId } });
    if (!report) {
      throw new GameException(ErrorCodes.REPORT_NOT_FOUND, '举报记录不存在');
    }
    if (report.status !== ReportStatus.PENDING) {
      throw new GameException(ErrorCodes.REPORT_ALREADY_HANDLED, '举报已处理');
    }
    const updates: Record<string, any> = {
      handlerAdminId: adminId,
      handleRemark: remark?.trim() || null,
      handledAt: new Date(),
    };
    if (action === ReportHandleAction.IGNORE) {
      updates.status = ReportStatus.IGNORED;
      updates.handleAction = ReportHandleAction.IGNORE;
    } else {
      if (report.targetType !== ReportTargetType.PLAYER) {
        throw new GameException(
          ErrorCodes.REPORT_INVALID_TARGET,
          '仅玩家类举报可施加惩罚',
        );
      }
      const player = await this.playerRepo.findOne({
        where: { id: report.targetId },
      });
      if (!player) {
        throw new GameException(ErrorCodes.REPORT_INVALID_TARGET, '目标玩家不存在');
      }
      const level =
        action === ReportHandleAction.WARN
          ? PenaltyLevel.WARNING
          : action === ReportHandleAction.MUTE
            ? PenaltyLevel.MUTE
            : PenaltyLevel.BAN;
      await this.authService.applyPenalty(
        adminName,
        player.id,
        player.accountId,
        level,
        remark?.trim() || '举报处置',
        durationSeconds,
      );
      if (level === PenaltyLevel.BAN) {
        await this.applyBanSocialConsequences(player.id);
      }
      updates.status = ReportStatus.PROCESSED;
      updates.handleAction = action;
      await this.adminService.logOperation({
        adminId,
        targetPlayerId: player.id,
        operation: 'community.report.handle',
        changeAfter: { id: report.id, action },
      });
    }
    await this.reportRepo.update({ id: reportId }, updates);
    return { ...report, ...updates } as PlayerReport;
  }

  // ===== 私有 =====

  private async grantAmbassadorTitle(playerId: string): Promise<void> {
    const title = await this.titleRepo.findOne({
      where: { name: AMBASSADOR_TITLE_NAME },
    });
    if (!title) return;
    const character = await this.charRepo.findOne({ where: { playerId } });
    if (!character) return;
    const existing = await this.charTitleRepo.findOne({
      where: { characterId: character.id, titleId: title.id },
    });
    if (existing) return;
    await this.charTitleRepo.save(
      this.charTitleRepo.create({
        characterId: character.id,
        titleId: title.id,
        isEquipped: false,
      }),
    );
  }

  private async withNickname(
    items: PlayerAmbassador[],
  ): Promise<(PlayerAmbassador & { nickname: string })[]> {
    if (!items.length) return items as (PlayerAmbassador & { nickname: string })[];
    const players = await this.playerRepo.find({
      where: { id: In(items.map((i) => i.playerId)) },
    });
    const map = new Map(players.map((p) => [p.id, p.nickname]));
    return items.map((i) => ({
      ...i,
      nickname: map.get(i.playerId) ?? '',
    }));
  }

  // ===== 封禁社交后果（阶段5批2） =====

  private async applyBanSocialConsequences(playerId: string): Promise<void> {
    // 1. 称号收回
    const character = await this.charRepo.findOne({ where: { playerId } });
    if (character) {
      const { affected } = await this.charTitleRepo.delete({
        characterId: character.id,
      });
      if (affected) {
        await this.adminService.logOperation({
          adminId: '0',
          targetPlayerId: playerId,
          operation: 'community.ban.title_revoke',
          changeBefore: { count: affected },
        });
      }
    }
    // 2. 帮派除名（含帮主移交/解散）
    const guildMember = await this.socialService.getMyGuildRole(playerId);
    if (guildMember?.guildId) {
      const result = await this.socialService.kickGuildMember(
        '0',
        guildMember.guildId,
        playerId,
        '封禁处置',
      );
      await this.adminService.logOperation({
        adminId: '0',
        targetPlayerId: playerId,
        operation: 'community.ban.guild_kick',
        changeAfter: result,
      });
    }
    // 3. 榜单移除
    const removed = await this.rankingService.removePlayerFromAll(playerId);
    await this.adminService.logOperation({
      adminId: '0',
      targetPlayerId: playerId,
      operation: 'community.ban.ranking_remove',
      changeAfter: { removed },
    });
  }

  async socialCleanup(
    adminId: string,
    playerId: string,
  ): Promise<{ cleaned: boolean }> {
    const character = await this.charRepo.findOne({ where: { playerId } });
    const guildMember = await this.socialService.getMyGuildRole(playerId);
    const titles = character
      ? await this.charTitleRepo.count({
          where: { characterId: character.id },
        })
      : 0;
    if (!titles && !guildMember) {
      // 榜单 Redis 无查询入口，直接执行移除视为幂等完成
      await this.rankingService.removePlayerFromAll(playerId);
      throw new GameException(
        ErrorCodes.CLEANUP_ALREADY_DONE,
        '该玩家无待清理的社交资产',
      );
    }
    await this.applyBanSocialConsequences(playerId);
    await this.adminService.logOperation({
      adminId,
      targetPlayerId: playerId,
      operation: 'community.social.cleanup',
      changeAfter: { playerId },
    });
    return { cleaned: true };
  }
}
