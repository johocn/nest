import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { ScoringConfigEntity } from './entities/scoring-config.entity';
import { ScoringConfig } from './scoring.types';
import { validateScoringConfig } from './scoring-config.validator';
import { ScoringService } from './scoring.service';

/**
 * scoring_configs admin CRUD（config jsonb 即 ScoringConfig 全量）。
 * - create/update 先 validateScoringConfig，成功即 registerGame 热更新；
 * - delete 软删即 unregister（仅摘内存注册，玩家状态行保留）；
 * - game_id 冲突检查含软删行（软删行仍占用唯一索引 uq_scoring_game，对齐 quiz/apps withDeleted 手法）。
 */
@Injectable()
export class ScoringAdminService {
  constructor(
    @InjectRepository(ScoringConfigEntity)
    private readonly configRepo: Repository<ScoringConfigEntity>,
    private readonly scoringService: ScoringService,
  ) {}

  async list(
    page: number,
    limit: number,
  ): Promise<{ items: ScoringConfigEntity[]; total: number }> {
    const [items, total] = await this.configRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async get(id: string): Promise<ScoringConfigEntity> {
    return this.findExisting(id);
  }

  async create(body: any): Promise<ScoringConfigEntity> {
    const cfg = body as ScoringConfig;
    this.assertValid(cfg);
    await this.assertGameAvailable(cfg.gameId);
    const saved = await this.configRepo.save(
      this.configRepo.create({ gameId: cfg.gameId, config: cfg }),
    );
    this.scoringService.registerGame(cfg);
    return saved;
  }

  async update(id: string, body: any): Promise<ScoringConfigEntity> {
    const row = await this.findExisting(id);
    // body 与既有 config 合并（部分字段更新），gameId 缺省沿用原值
    const cfg: ScoringConfig = {
      ...row.config,
      ...body,
      gameId: body?.gameId ?? row.gameId,
    };
    this.assertValid(cfg);
    await this.assertGameAvailable(cfg.gameId, row.id);
    row.gameId = cfg.gameId;
    row.config = cfg;
    const saved = await this.configRepo.save(row);
    this.scoringService.registerGame(cfg);
    return saved;
  }

  async delete(id: string): Promise<void> {
    const row = await this.findExisting(id);
    await this.configRepo.softRemove(row);
    this.scoringService.unregister(row.gameId);
  }

  /** 目标不存在（含软删行视为不存在，findOne 默认过滤 DeleteDateColumn）→ 47001 */
  private async findExisting(id: string): Promise<ScoringConfigEntity> {
    const row = await this.configRepo.findOne({ where: { id } });
    if (!row) {
      throw new GameException(ErrorCodes.SCORING_GAME_NOT_FOUND, '评分配置不存在');
    }
    return row;
  }

  /** 校验失败 → 47002，消息携带 validator 明细 */
  private assertValid(cfg: unknown): void {
    const errors = validateScoringConfig(cfg);
    if (errors.length > 0) {
      throw new GameException(ErrorCodes.SCORING_CONFIG_INVALID, errors.join('；'));
    }
  }

  /** game_id 唯一校验（withDeleted 连软删行一并查）；excludeId 供 update 排除自身 */
  private async assertGameAvailable(gameId: string, excludeId?: string): Promise<void> {
    const exists = await this.configRepo.findOne({
      where: { gameId },
      withDeleted: true,
    });
    if (exists && exists.id !== excludeId) {
      throw new GameException(ErrorCodes.SCORING_GAME_EXISTS, `game_id 已存在: ${gameId}`);
    }
  }
}
