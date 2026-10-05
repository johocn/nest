import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ServerStatusService } from './server-status.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';

@ApiTags('ServerStatus')
@ApiBearerAuth()
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
}
