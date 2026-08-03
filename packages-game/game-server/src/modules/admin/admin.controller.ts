import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminGuard } from '@common/guards/admin.guard';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Admin-Operations')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/ops')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('online')
  @ApiOperation({ summary: '实时在线人数' })
  async getOnlineCount() {
    return this.adminService.getOnlineCount();
  }

  @Get('gm-log/list')
  @ApiOperation({ summary: 'GM操作日志列表' })
  async getGmLogs(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.adminService.getGmLogs(Number(page), Number(limit));
  }

  @Post('gm-log')
  @ApiOperation({ summary: '记录GM操作' })
  async logOperation(
    @Req() req: { user: AdminJwtPayload },
    @Body()
    body: {
      targetPlayerId?: string;
      operation: string;
      changeBefore?: Record<string, any>;
      changeAfter?: Record<string, any>;
    },
  ) {
    return this.adminService.logOperation({
      adminId: req.user.adminId,
      targetPlayerId: body.targetPlayerId,
      operation: body.operation,
      changeBefore: body.changeBefore,
      changeAfter: body.changeAfter,
    });
  }
}
