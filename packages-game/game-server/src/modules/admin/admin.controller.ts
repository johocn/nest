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
import { GmCommandService } from './gm-command.service';
import { AdminGuard } from '@common/guards/admin.guard';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Admin-Operations')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/ops')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly gmService: GmCommandService,
  ) {}

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

  // ===== GM 命令执行器 =====

  @Get('gm/list')
  @ApiOperation({ summary: '列出所有可用 GM 命令（前端下拉选择 + 参数提示用）' })
  async listGmCommands() {
    return { commands: this.gmService.list() };
  }

  @Post('gm/execute')
  @ApiOperation({ summary: '执行 GM 命令（结构化 JSON）' })
  async executeGm(
    @Req() req: { user: AdminJwtPayload },
    @Body()
    body: {
      /** 命令名，如 'player.give-exp' */
      cmd: string;
      /** 目标玩家 ID（可选，命令 args 里也能放） */
      targetPlayerId?: string;
      /** 命令参数，见 gm/list 的 argsSchema */
      args?: Record<string, any>;
    },
  ) {
    return this.gmService.execute({
      adminId: req.user.adminId,
      targetPlayerId: body.targetPlayerId,
      args: { cmd: body.cmd, ...(body.args ?? {}) },
    });
  }
}
