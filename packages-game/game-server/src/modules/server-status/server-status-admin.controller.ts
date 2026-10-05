import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServerStatusService } from './server-status.service';
import { AdminGuard } from '@common/guards/admin.guard';

/** 服务器状态管理端（admin-web 路由前缀 api/admin/v1/server） */
@ApiTags('Admin-ServerStatus')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/server')
export class ServerStatusAdminController {
  constructor(private readonly statusService: ServerStatusService) {}

  @Get('status')
  @ApiOperation({ summary: '服务器状态（管理端）' })
  async getAdminStatus() {
    return this.statusService.getServerStatus();
  }

  @Get('online-stats')
  @ApiOperation({ summary: '在线统计' })
  async getOnlineStats() {
    return this.statusService.getOnlineStats();
  }

  @Post('maintenance')
  @ApiOperation({ summary: '维护模式开关' })
  async setMaintenance(@Body() body: any) {
    return this.statusService.setMaintenance(body.enabled, body.message);
  }
}
