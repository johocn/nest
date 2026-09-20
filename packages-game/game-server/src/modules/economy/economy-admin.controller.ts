import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from '@common/guards/admin.guard';
import {
  EconomyDashboardService,
  EconomyDashboardSnapshot,
} from './economy-dashboard.service';

@ApiTags('Admin-Economy')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/economy')
export class EconomyAdminController {
  constructor(
    private readonly economyDashboardService: EconomyDashboardService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'GM 经济宏观看板：通胀/资产分布/冻结量/回收额（只读）' })
  async dashboard(): Promise<EconomyDashboardSnapshot> {
    return this.economyDashboardService.dashboard();
  }
}