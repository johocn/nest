import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlayerReport } from './entities/player-report.entity';
import { ReportStatus } from '@constants/enums';
import { AdminGuard } from '@common/guards/admin.guard';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import { AdminService } from '@modules/admin/admin.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@ApiTags('Admin-Social-Report')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/social/reports')
export class SocialReportAdminController {
  constructor(
    @InjectRepository(PlayerReport)
    private readonly reportRepo: Repository<PlayerReport>,
    private readonly adminService: AdminService,
  ) {}

  @Get()
  @ApiOperation({ summary: '举报列表（支持 reporterId / targetId / status + 分页）' })
  async listReports(
    @Query('reporterId') reporterId?: string,
    @Query('targetId') targetId?: string,
    @Query('status') status?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const where: any = {};
    if (reporterId) where.reporterId = reporterId;
    if (targetId) where.targetId = targetId;
    if (status) where.status = status;
    const [list, total] = await this.reportRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Get(':id')
  @ApiOperation({ summary: '举报详情' })
  async getReport(@Param('id') id: string) {
    const item = await this.reportRepo.findOne({ where: { id } });
    if (!item) throw new GameException(ErrorCodes.REPORT_NOT_FOUND, 'Report not found');
    return item;
  }

  @Post(':id/handle')
  @ApiOperation({ summary: '处理举报（status→handled + 可选封禁 action）' })
  async handleReport(
    @Param('id') id: string,
    @Body()
    body: {
      handleAction?: string;
      handleRemark?: string;
      status?: string;
    },
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const item = await this.reportRepo.findOne({ where: { id } });
    if (!item) throw new GameException(ErrorCodes.REPORT_NOT_FOUND, 'Report not found');
    const before = { status: item.status, handleAction: item.handleAction };
    (item as any).status = body.status ?? ReportStatus.PROCESSED;
    item.handleAction = body.handleAction ?? null;
    item.handleRemark = body.handleRemark ?? null;
    item.handlerAdminId = admin.adminId;
    item.handledAt = new Date();
    const saved = await this.reportRepo.save(item);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'social.report.handle',
      targetPlayerId: item.targetId,
      changeBefore: before,
      changeAfter: {
        status: saved.status,
        handleAction: saved.handleAction,
        handleRemark: saved.handleRemark,
      },
    });
    return saved;
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除举报（硬删）' })
  async deleteReport(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const item = await this.reportRepo.findOne({ where: { id } });
    if (!item) throw new GameException(ErrorCodes.REPORT_NOT_FOUND, 'Report not found');
    await this.reportRepo.delete(id);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'social.report.delete',
      targetPlayerId: item.targetId,
      changeBefore: { id: item.id, reason: item.reason },
    });
    return { removed: id };
  }
}
