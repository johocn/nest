import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrossGameRecord } from './cross-game-record.entity';
import { SubmitCrossGameRecordDto } from './dto/submit-cross-game-record.dto';
import { ALLOWED_TARGET_GAMES } from './config/targets';
import { ErrorCodes } from '@constants/error-codes';
import { GameException } from '@common/exceptions/game.exception';

export interface RecordResult {
  updated: boolean;
  best: number;
}

@Injectable()
export class CrossGameRecordService {
  constructor(
    @InjectRepository(CrossGameRecord)
    private readonly repo: Repository<CrossGameRecord>,
  ) {}

  /**
   * 写入一条跨游戏评分。playerId 由调用方（controller）从 JWT 注入，本方法不再信任任何外部传入。
   * 白名单校验 targetGameId；唯一键 (playerId,targetGameId,levelId) 仅保留最佳 score。
   */
  async record(
    playerId: string,
    dto: SubmitCrossGameRecordDto,
  ): Promise<RecordResult> {
    if (!ALLOWED_TARGET_GAMES.includes(dto.targetGameId)) {
      throw new GameException(
        ErrorCodes.CROSS_GAME_TARGET_INVALID,
        `非法的目标游戏：${dto.targetGameId}`,
      );
    }

    const existing = await this.repo.findOne({
      where: { playerId, targetGameId: dto.targetGameId, levelId: dto.levelId },
    });

    // 已有更好成绩 → 不覆盖（防刷分）
    if (existing && existing.score >= dto.score) {
      return { updated: false, best: existing.score };
    }

    if (existing) {
      existing.score = dto.score;
      existing.mode = dto.mode;
      existing.axes = dto.axes;
      existing.rawMetrics = dto.rawMetrics;
      await this.repo.save(existing);
      return { updated: true, best: dto.score };
    }

    await this.repo.save(
      this.repo.create({
        playerId,
        targetGameId: dto.targetGameId,
        levelId: dto.levelId,
        mode: dto.mode,
        score: dto.score,
        axes: dto.axes,
        rawMetrics: dto.rawMetrics,
      }),
    );
    return { updated: true, best: dto.score };
  }

  /** 查询本人跨游戏记录，可按目标游戏过滤 */
  async list(
    playerId: string,
    targetGameId?: string,
  ): Promise<CrossGameRecord[]> {
    const where = targetGameId ? { playerId, targetGameId } : { playerId };
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }
}
