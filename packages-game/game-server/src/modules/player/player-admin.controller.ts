import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlayerService } from './player.service';
import { AdminPlayerQueryDto } from './dto/admin-player-query.dto';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Player')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/player')
export class PlayerAdminController {
  constructor(private readonly playerService: PlayerService) {}

  @Get('list')
  @ApiOperation({ summary: '分页查询玩家列表' })
  async list(@Query() query: AdminPlayerQueryDto) {
    return this.playerService.findPaginated(query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id/detail')
  @ApiOperation({ summary: '玩家全量档案' })
  async detail(@Param('id') id: string) {
    return this.playerService.getBaseInfo(id);
  }
}
