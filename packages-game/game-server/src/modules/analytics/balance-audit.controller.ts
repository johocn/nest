import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BalanceAuditService } from './balance-audit.service';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/balance')
export class BalanceAuditController {
  constructor(private readonly balanceAuditService: BalanceAuditService) {}

  @Get('audit')
  @ApiOperation({ summary: '平衡体检（15.8 四象限）' })
  async audit() {
    return this.balanceAuditService.audit();
  }
}
