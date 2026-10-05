import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from '@common/guards/admin.guard';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import { AdminService } from '@modules/admin/admin.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import {
  EconomyDashboardService,
  EconomyDashboardSnapshot,
} from './economy-dashboard.service';
import { Transaction } from './entities/transaction.entity';
import { PlayerCurrency } from '@modules/player/entities/player-currency.entity';
import { RiskRecoverRecord } from '@modules/risk/entities/risk-recover-record.entity';
import { RiskRecoverStatus } from '@constants/enums';

@ApiTags('Admin-Economy')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/economy')
export class EconomyAdminController {
  constructor(
    private readonly economyDashboardService: EconomyDashboardService,
    private readonly adminService: AdminService,
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    @InjectRepository(PlayerCurrency)
    private readonly currencyRepo: Repository<PlayerCurrency>,
    @InjectRepository(RiskRecoverRecord)
    private readonly riskRecoverRepo: Repository<RiskRecoverRecord>,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'GM 经济宏观看板：通胀/资产分布/冻结量/回收额（只读）' })
  async dashboard(): Promise<EconomyDashboardSnapshot> {
    return this.economyDashboardService.dashboard();
  }

  // ---------- Transaction ----------

  @Get('transactions')
  @ApiOperation({ summary: '资产流水查询（支持 playerId / currencyType / txType / source + 时间范围 + 分页）' })
  async listTransactions(
    @Query('playerId') playerId?: string,
    @Query('currencyType') currencyType?: string,
    @Query('txType') txType?: string,
    @Query('source') source?: string,
    @Query('startAt') startAt?: string,
    @Query('endAt') endAt?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const where: any = {};
    if (playerId) where.playerId = playerId;
    if (currencyType) where.currencyType = currencyType;
    if (txType) where.txType = txType;
    if (source) where.source = source;

    const qb = this.transactionRepo.createQueryBuilder('tx');
    Object.entries(where).forEach(([k, v]) => qb.andWhere(`tx.${k} = :${k}`, { [k]: v }));

    if (startAt) {
      qb.andWhere('tx.createdAt >= :startAt', { startAt: new Date(startAt) });
    }
    if (endAt) {
      qb.andWhere('tx.createdAt <= :endAt', { endAt: new Date(endAt) });
    }

    qb.orderBy('tx.createdAt', 'DESC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit));

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: '流水详情' })
  async getTransaction(@Param('id') id: string) {
    const item = await this.transactionRepo.findOne({ where: { id } });
    if (!item) throw new GameException(ErrorCodes.PARAM_INVALID, 'Transaction not found');
    return item;
  }

  // ---------- PlayerCurrency ----------

  @Get('currencies/:playerId')
  @ApiOperation({ summary: '指定玩家资产概况（PlayerCurrency 全部 + 总余额统计）' })
  async getPlayerCurrencies(@Param('playerId') playerId: string) {
    const list = await this.currencyRepo.find({ where: { playerId } });
    // 每种币种转 number 相加后返回字符串形式，避免 bigint 精度问题
    const totalByType: Record<string, string> = {};
    let grandTotal = 0n;
    for (const row of list) {
      const b = BigInt(row.amount);
      grandTotal += b;
      totalByType[row.currencyType] = row.amount;
    }
    return {
      playerId,
      currencies: list,
      summary: {
        totalByType,
        grandTotal: grandTotal.toString(),
      },
    };
  }

  // ---------- RiskRecoverRecord ----------

  @Get('risk-recovers')
  @ApiOperation({ summary: '风险追回记录列表（支持 status + 分页）' })
  async listRiskRecovers(
    @Query('status') status?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const where: any = {};
    if (status) where.status = status;
    const [list, total] = await this.riskRecoverRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Post('risk-recovers/:id/resolve')
  @ApiOperation({ summary: '管理员手动介入追回（设置 handledBy + 保留 APPLIED 状态）' })
  async resolveRiskRecover(
    @Param('id') id: string,
    @Body() body?: { note?: string },
    @CurrentAdmin() admin?: AdminJwtPayload,
  ) {
    const item = await this.riskRecoverRepo.findOne({ where: { id } });
    if (!item) throw new GameException(ErrorCodes.RISK_RECOVER_NOT_FOUND, 'RiskRecoverRecord not found');
    const before = { status: item.status, handledBy: item.handledBy };
    // RiskRecoverStatus 仅 APPLIED / ROLLED_BACK；resolve 视为管理员确认，保留 APPLIED 仅写 handledBy
    if (item.status !== RiskRecoverStatus.APPLIED) {
      (item as any).status = RiskRecoverStatus.APPLIED;
    }
    item.handledBy = admin?.adminId ?? 'unknown';
    const saved = await this.riskRecoverRepo.save(item);
    await this.adminService.logOperation({
      adminId: admin?.adminId ?? 'unknown',
      operation: 'economy.risk_recover.resolve',
      changeBefore: before,
      changeAfter: { status: saved.status, handledBy: saved.handledBy, note: body?.note },
    });
    return saved;
  }
}
