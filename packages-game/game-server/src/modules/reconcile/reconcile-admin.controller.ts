import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReconcileService } from './reconcile.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { AdminService } from '@modules/admin/admin.service';
import { ReconcileType } from '@constants/enums';

@ApiTags('Admin-Reconcile')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/reconcile')
export class ReconcileAdminController {
  constructor(
    private readonly reconcileService: ReconcileService,
    private readonly adminService: AdminService,
  ) {}

  @Get('results')
  @ApiOperation({ summary: '对账结果列表（按日倒序）' })
  async listResults(@Query('type') type?: string) {
    const t = type as ReconcileType | undefined;
    return { list: await this.reconcileService.listResults(t) };
  }

  @Post('run')
  @ApiOperation({ summary: '手动触发日终对账（只标记不自动动账）' })
  async run(@CurrentAdmin() admin: AdminJwtPayload) {
    const results = await this.reconcileService.reconcileDaily();
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'reconcile.run',
      changeAfter: {
        statDate: results[0]?.statDate,
        types: results.map((r) => ({
          type: r.reconcileType,
          checked: r.checked,
          mismatch: r.mismatch,
        })),
      },
    });
    return { results };
  }
}