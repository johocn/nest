import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, IsNull, Not } from 'typeorm';
import {
  GiftCode,
  GiftCodeTemplate,
  GiftCodeRedemption,
} from './entities';
import {
  GiftCodeGenerateType,
  GiftCodeClaimLimit,
  GiftCodeStatus,
} from '@constants/enums';
import { CacheService } from '@cache/cache.service';
import { InventoryService } from '@modules/inventory/inventory.service';
import { PlayerService } from '@modules/player/player.service';
import { EconomyService } from '@modules/economy/economy.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { CurrencyType } from '@constants/enums';

const ONE_PER_PLAYER_KEY = (templateId: string) =>
  `giftcode:claimed:template:${templateId}`;
const PLAYER_TEMPLATE_REDEEMED_KEY = (playerId: string, templateId: string) =>
  `giftcode:claimed:player:${playerId}:template:${templateId}`;

@Injectable()
export class GiftCodeService {
  private readonly logger = new Logger(GiftCodeService.name);

  constructor(
    @InjectRepository(GiftCodeTemplate)
    private readonly templateRepo: Repository<GiftCodeTemplate>,
    @InjectRepository(GiftCode)
    private readonly codeRepo: Repository<GiftCode>,
    @InjectRepository(GiftCodeRedemption)
    private readonly redemptionRepo: Repository<GiftCodeRedemption>,
    private readonly cacheService: CacheService,
    private readonly inventoryService: InventoryService,
    private readonly playerService: PlayerService,
    private readonly economyService: EconomyService,
  ) {}

  // ===== Template Admin =====

  async createTemplate(
    data: Partial<GiftCodeTemplate>,
  ): Promise<GiftCodeTemplate> {
    const tpl = this.templateRepo.create(data);
    return this.templateRepo.save(tpl);
  }

  async listTemplates(
    page = 1,
    limit = 20,
  ): Promise<{ items: GiftCodeTemplate[]; total: number }> {
    const [items, total] = await this.templateRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async updateTemplate(
    id: string,
    data: Partial<GiftCodeTemplate>,
  ): Promise<GiftCodeTemplate | null> {
    const t = await this.templateRepo.findOne({ where: { id } });
    if (!t) return null;
    Object.assign(t, data);
    return this.templateRepo.save(t);
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.templateRepo.softDelete(id);
  }

  // ===== Code Generation =====

  /**
   * 批量/规则生成兑换码
   * @param templateId 模板 ID
   * @param count 生成数量（BATCH/PATTERN 必填，CUSTOM 忽略）
   * @param customCodes CUSTOM 模式传入的固定码数组
   */
  async generate(
    templateId: string,
    opts: {
      count?: number;
      customCodes?: string[];
      expiresAt?: Date; // 可覆盖模板 validSeconds
    } = {},
  ): Promise<{ generated: number; codes: string[] }> {
    const tpl = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!tpl) throw new BadRequestException('模板不存在');

    let codes: string[] = [];

    if (tpl.generateType === GiftCodeGenerateType.CUSTOM) {
      if (!opts.customCodes?.length) throw new BadRequestException('CUSTOM 模式需提供 customCodes');
      codes = opts.customCodes;
    } else {
      const count = opts.count ?? 1;
      if (count <= 0) throw new BadRequestException('count 必须 > 0');
      codes = Array.from({ length: count }, () => this.buildCode(tpl));
    }

    // 批量写入 DB
    const tplId = templateId;
    const expiresAt =
      opts.expiresAt ??
      (tpl.validSeconds > 0
        ? new Date(Date.now() + tpl.validSeconds * 1000)
        : null);

    const entities = codes.map((code) =>
      this.codeRepo.create({
        code,
        templateId: tplId,
        expiresAt,
        status: GiftCodeStatus.ACTIVE,
      }),
    );
    await this.codeRepo.save(entities);

    this.logger.log(`[GiftCode] 生成 ${codes.length} 条 ${tpl.name}`);
    return { generated: codes.length, codes };
  }

  /** 构建单条码：PATTERN 用前缀+日期+随机段，BATCH 直接 16 位随机 */
  private buildCode(tpl: GiftCodeTemplate): string {
    if (tpl.generateType === GiftCodeGenerateType.PATTERN) {
      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
      return `${tpl.prefix ?? ''}${datePart}${rand}`;
    }
    // BATCH: 16 位大写字母数字
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 16; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // ===== Redemption（玩家兑换） =====

  /**
   * 玩家兑换 —— 核心路径：
   *  1) 找码 + 校验状态/有效期/模板启用
   *  2) GiftCodeClaimLimit.ONE_PER_PLAYER → Redis Set 查是否已领过该模板
   *  3) 原子更新 GiftCode status → used + claimedBy
   *  4) 按 template.rewards 发奖（道具 / 货币 / 经验 / VIP 经验）
   *  5) 写 GiftCodeRedemption + Redis Set 登记
   */
  async redeem(playerId: string, codeInput: string): Promise<{
    ok: boolean;
    rewards: Record<string, any>;
    templateName: string;
  }> {
    // 1) 查码
    const code = await this.codeRepo.findOne({
      where: { code: codeInput.trim().toUpperCase() },
      relations: ['templateId'] as any,
    });
    if (!code) throw new GameException(ErrorCodes.PARAM_INVALID, '兑换码不存在');
    const tpl = await this.templateRepo.findOne({ where: { id: code.templateId } });
    if (!tpl) throw new GameException(ErrorCodes.PARAM_INVALID, '兑换码模板已删除');

    // 2) 模板启用校验
    if (!tpl.enabled) throw new GameException(ErrorCodes.PARAM_INVALID, '该兑换码已停用');

    // 3) 码状态 + 有效期
    if (code.status !== GiftCodeStatus.ACTIVE) {
      if (code.status === GiftCodeStatus.USED) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '该兑换码已被使用');
      }
      if (code.status === GiftCodeStatus.DISABLED) {
        throw new GameException(ErrorCodes.PARAM_INVALID, '该兑换码已停用');
      }
    }
    const now = new Date();
    if (code.expiresAt && code.expiresAt < now) {
      // 自动过期标记
      if (code.status !== GiftCodeStatus.EXPIRED) {
        await this.codeRepo.update(code.id, { status: GiftCodeStatus.EXPIRED });
      }
      throw new GameException(ErrorCodes.PARAM_INVALID, '该兑换码已过期');
    }

    // 4) 限领口径
    if (tpl.claimLimit === GiftCodeClaimLimit.ONE_PER_PLAYER) {
      const claimed = await this.cacheService.exists(
        PLAYER_TEMPLATE_REDEEMED_KEY(playerId, tpl.id),
      );
      if (claimed) {
        throw new GameException(
          ErrorCodes.PARAM_INVALID,
          `您已领取过 ${tpl.name}，不可重复领取`,
        );
      }
    }

    // 5) 模板总量上限
    if (tpl.totalLimit > 0 && tpl.claimedCount >= tpl.totalLimit) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '该礼包已领完');
    }

    // 6) 原子扣码状态
    const affected = await this.codeRepo.update(
      { id: code.id, status: GiftCodeStatus.ACTIVE },
      {
        status: GiftCodeStatus.USED,
        claimedBy: playerId,
        claimedAt: now,
      },
    );
    if (affected.affected === 0) {
      // 并发下被别人先领了
      throw new GameException(ErrorCodes.PARAM_INVALID, '该兑换码已被领取，请刷新重试');
    }

    // 7) 发奖
    const rewards: Record<string, any> = {};
    const opTrace = `giftcode:${tpl.id}:${code.id}:${playerId}`;

    // 7a) 道具
    if (tpl.rewards.items?.length) {
      const items = [];
      for (const r of tpl.rewards.items) {
        const item = await this.inventoryService.addItem(
          playerId,
          String(r.itemTemplateId),
          Number(r.quantity),
          opTrace,
        );
        items.push({ itemId: item.id, templateId: r.itemTemplateId, quantity: r.quantity });
      }
      rewards.items = items;
    }

    // 7b) 经验
    if (tpl.rewards.exp && tpl.rewards.exp > 0) {
      const res = await this.playerService.addExp(playerId, Number(tpl.rewards.exp));
      rewards.exp = res.player.exp;
      rewards.leveledUp = res.leveledUp;
    }

    // 7c) VIP 经验
    if (tpl.rewards.vipExp && tpl.rewards.vipExp > 0) {
      const res = await this.playerService.addVipExp(playerId, Number(tpl.rewards.vipExp));
      rewards.vipExp = res.vipExp;
      rewards.newVipLevel = res.vipLevel;
    }

    // 货币
    if (tpl.rewards.currency && Object.keys(tpl.rewards.currency).length) {
      const curRes: Record<string, any> = {};
      for (const [curType, amount] of Object.entries(tpl.rewards.currency)) {
        const currency = await this.economyService.addCurrency(
          playerId,
          curType as CurrencyType,
          Number(amount),
          'giftcode',
          opTrace,
        );
        curRes[curType] = currency;
      }
      rewards.currency = curRes;
    }

    // 8) 写记录 + Redis 标记
    await Promise.all([
      this.redemptionRepo.save(
        this.redemptionRepo.create({
          codeId: code.id,
          templateId: tpl.id,
          playerId,
          codeSnapshot: code.code,
          rewardSnapshot: tpl.rewards as any,
        }),
      ),
      this.templateRepo.increment({ id: tpl.id }, 'claimedCount', 1),
      tpl.claimLimit === GiftCodeClaimLimit.ONE_PER_PLAYER
        ? this.cacheService.set(PLAYER_TEMPLATE_REDEEMED_KEY(playerId, tpl.id), '1', 60 * 60 * 24 * 30) // 30 天防止重刷
        : Promise.resolve(null),
    ]);

    this.logger.log(`[GiftCode] ${playerId} redeem ${code.code} template=${tpl.name}`);
    return { ok: true, rewards, templateName: tpl.name };
  }

  // ===== Admin 查询 =====

  async listCodes(
    templateId?: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: GiftCode[]; total: number }> {
    const where: any = {};
    if (templateId) where.templateId = templateId;
    const [items, total] = await this.codeRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async listRedemptions(
    playerId?: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: GiftCodeRedemption[]; total: number }> {
    const where: any = {};
    if (playerId) where.playerId = playerId;
    const [items, total] = await this.redemptionRepo.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }
}
