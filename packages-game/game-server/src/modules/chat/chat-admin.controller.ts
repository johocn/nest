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
import type { ChatMessage, SupportTicket } from './entities';

/**
 * admin-web ↔ entity 字段映射层
 *
 * ChatMessage entity → admin-web ChatLog:
 *   channel → channelType,  senderName → sender,  recipientId → target,
 *   content → message,  createdAt → sentAt
 *
 * SupportTicket entity → admin-web SupportTicket:
 *   channel → category,  content → question
 */

const mapChatMessage = (m: ChatMessage): Record<string, any> => ({
  id: m.id,
  channelType: m.channel,
  sender: m.senderName,
  target: m.recipientId,
  guildId: m.guildId,
  message: m.content,
  sentAt: m.createdAt,
});

const mapTicket = (t: SupportTicket): Record<string, any> => ({
  id: t.id,
  playerId: t.playerId,
  category: t.channel,
  keyword: t.keyword,
  question: t.content,
  status: t.status,
  autoReply: t.autoReply,
  gmReply: t.gmReply,
  adminId: t.adminId,
  handledAt: t.handledAt,
  createdAt: t.createdAt,
});

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
    const result = await this.chatService.searchMessages(
      { channel: channel as any, senderId, keyword },
      Number(page),
      Number(limit),
    );
    return {
      ...result,
      items: result.items.map(mapChatMessage),
    };
  }

  @Get('support/list')
  @ApiOperation({ summary: '客服工单列表（支持 status + 分页）' })
  async listSupportTickets(
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const result = await this.chatService.listTickets(
      status as any,
      Number(page),
      Number(limit),
    );
    return {
      ...result,
      items: result.items.map(mapTicket),
    };
  }

  @Post('support/:id/reply')
  @ApiOperation({ summary: '回复客服工单' })
  async replyTicket(
    @CurrentAdmin() admin: { adminId: string },
    @Param('id') id: string,
    @Body() body: { reply: string },
  ) {
    const ticket = await this.chatService.replyTicket(admin.adminId, id, body.reply);
    return mapTicket(ticket);
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
