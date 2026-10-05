import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LadderService } from './ladder.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { CurrentAdminData } from '@common/decorators/current-admin.decorator';

@ApiTags('Admin-Ladder')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/ladder')
export class LadderAdminController {
  constructor(private readonly ladderService: LadderService) {}

  @Get('top')
  @ApiOperation({ summary: '[Admin] 天梯榜单 Top N' })
  async getTopN(@Query('limit') limit: string) {
    return this.ladderService.getTopN(Number(limit) || 50);
  }

  @Post('settle')
  @ApiOperation({ summary: '[Admin] 赛季结算' })
  async settleSeason(@CurrentAdmin() admin: CurrentAdminData) {
    return this.ladderService.settleSeason(admin.adminId);
  }

  @Post('refresh')
  @ApiOperation({ summary: '[Admin] 刷新 Redis ZSet 缓存' })
  async refresh() {
    const count = await this.ladderService.refreshSeasonCache();
    return { refreshed: count };
  }
}
