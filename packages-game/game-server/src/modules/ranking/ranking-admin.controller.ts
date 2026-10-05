import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RankingService } from './ranking.service';
import { RankingType } from '@constants/enums';
import { AdminGuard } from '@common/guards/admin.guard';

/** 排行榜管理端（admin-web 路由前缀 api/admin/v1/ranking） */
@ApiTags('Admin-Ranking')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/ranking')
export class RankingAdminController {
  constructor(private readonly rankingService: RankingService) {}

  @Post(':type/snapshot')
  @ApiOperation({ summary: '创建排行榜快照' })
  async createSnapshot(@Param('type') type: RankingType) {
    const count = await this.rankingService.createSnapshot(type);
    return { success: true, count };
  }

  @Get('snapshot/list')
  @ApiOperation({ summary: '排行榜快照列表' })
  async getSnapshotList(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.rankingService.getSnapshotList(Number(page), Number(limit));
  }

  @Post(':type/refresh')
  @ApiOperation({ summary: '从 DB 快照重建 Redis ZSet（Redis flush 后恢复）' })
  async refreshFromDB(@Param('type') type: RankingType) {
    const count = await this.rankingService.refreshFromDB(type);
    return { success: true, restored: count };
  }

  @Post('refresh')
  @ApiOperation({ summary: '从 DB 快照重建所有类型 Redis ZSet' })
  async refreshAllFromDB() {
    const count = await this.rankingService.refreshFromDB();
    return { success: true, restored: count };
  }
}
