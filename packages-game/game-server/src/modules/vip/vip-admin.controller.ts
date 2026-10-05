import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VipService } from './vip.service';
import { AdminGuard } from '@common/guards/admin.guard';

/** VIP 配置 CRUD（admin-web 路由前缀 api/admin/v1/vip） */
@ApiTags('Admin-VIP')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/vip')
export class VipAdminController {
  constructor(private readonly vipService: VipService) {}

  @Get('config/list')
  @ApiOperation({ summary: 'VIP 配置列表' })
  async listConfigs() {
    return this.vipService.getConfigList();
  }

  @Post('config')
  @ApiOperation({ summary: '创建 VIP 配置' })
  async createConfig(@Body() body: any) {
    return this.vipService.createConfig(body);
  }

  @Patch('config/:level')
  @ApiOperation({ summary: '更新 VIP 配置' })
  async updateConfig(
    @Param('level') level: string,
    @Body() body: any,
  ) {
    return this.vipService.updateConfig(Number(level), body);
  }

  @Delete('config/:level')
  @ApiOperation({ summary: '删除 VIP 配置' })
  async deleteConfig(@Param('level') level: string) {
    return this.vipService.deleteConfig(Number(level));
  }
}
