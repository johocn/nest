import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';

/** 聊天日志 + 客服工单 + 幸运星抽奖（admin-web 路由前缀 api/admin/v1/chat） */
@ApiTags('Admin-Chat')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/chat')
export class ChatAdminController {
  constructor(private readonly chatService: ChatService) {}

  @Get('log/list')
  @ApiOperation({ summary: '聊天日志列表（支持 channel/senderId/keyword + 分页）' })
  async listChatMessages(
    @Query('channel') channel?: string,
    @Query('senderId') senderId?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.chatService.searchMessages(
      { channel: channel as any, senderId, keyword },
      Number(page),
      Number(limit),
    );
  }

  @Get('support/list')
  @ApiOperation({ summary: '客服工单列表（支持 status + 分页）' })
  async listSupportTickets(
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.chatService.listTickets(
      status as any,
      Number(page),
      Number(limit),
    );
  }

  @Post('support/:id/reply')
  @ApiOperation({ summary: '回复客服工单' })
  async replyTicket(
    @CurrentAdmin() admin: { adminId: string },
    @Param('id') id: string,
    @Body() body: { reply: string },
  ) {
    return this.chatService.replyTicket(admin.adminId, id, body.reply);
  }

  @Post('lucky-star/draw')
  @ApiOperation({ summary: '执行幸运星抽奖' })
  async drawLuckyStar(
    @CurrentAdmin() admin: { adminId: string },
    @Body() body: { count?: number; days?: number },
  ) {
    return this.chatService.drawLuckyStar(
      admin.adminId,
      body.count ?? 10,
      body.days ?? 1,
    );
  }
}
