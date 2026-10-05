import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VipService } from './vip.service';
import { CreateVipConfigDto } from './dto/create-vip-config.dto';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-VIP')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/vips')
export class VipAdminController {
  constructor(private readonly vipService: VipService) {}

  @Get('config')
  @ApiOperation({ summary: 'VIP 配置列表' })
  async list() {
    return this.vipService.getConfigList();
  }

  @Get('config/:level')
  @ApiOperation({ summary: 'VIP 配置详情' })
  async get(@Param('level') level: string) {
    return this.vipService.getConfigDetail(Number(level));
  }

  @Post('config')
  @ApiOperation({ summary: '创建 VIP 配置' })
  async create(@Body() dto: CreateVipConfigDto) {
    return this.vipService.createConfig(dto);
  }

  @Patch('config/:level')
  @ApiOperation({ summary: '更新 VIP 配置' })
  async update(
    @Param('level') level: string,
    @Body() dto: Partial<CreateVipConfigDto>,
  ) {
    return this.vipService.updateConfig(Number(level), dto);
  }

  @Get('players')
  @ApiOperation({ summary: '查询指定 VIP 等级的玩家（分页）' })
  async players(
    @Query('level') level: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.vipService.getPlayersByVipLevel(
      Number(level),
      Number(page),
      Number(limit),
    );
  }

  @Delete('config/:level')
  @ApiOperation({ summary: '删除 VIP 配置' })
  async remove(@Param('level') level: string) {
    return this.vipService.deleteConfig(Number(level));
  }
}
