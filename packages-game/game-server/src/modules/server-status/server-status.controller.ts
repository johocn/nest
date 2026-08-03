import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServerStatusService } from './server-status.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

@ApiTags('ServerStatus')
@Controller()
export class ServerStatusController {
  constructor(private readonly statusService: ServerStatusService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/server/status')
  @ApiOperation({ summary: '服务器状态' })
  async getStatus() {
    return this.statusService.getServerStatus();
  }

  // ===== Admin =====

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('api/admin/v1/server/status')
  @ApiOperation({ summary: '服务器状态（管理端）' })
  async getAdminStatus() {
    return this.statusService.getServerStatus();
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('api/admin/v1/server/online-stats')
  @ApiOperation({ summary: '在线统计' })
  async getOnlineStats() {
    return this.statusService.getOnlineStats();
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/server/maintenance')
  @ApiOperation({ summary: '维护模式开关' })
  async setMaintenance(@Body() body: { enabled: boolean; message?: string }) {
    return this.statusService.setMaintenance(body.enabled, body.message);
  }
}
