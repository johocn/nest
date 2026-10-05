import {
  Body,
  Controller,
  Delete,
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
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { ChatChannel } from '@constants/enums';

@ApiTags('Admin-Chat')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/chat')
export class ChatAdminController {
  constructor(private readonly chatService: ChatService) {}

  @Get('messages')
  @ApiOperation({ summary: '消息列表（按 channel/senderId/关键词 筛选 + 分页）' })
  async listMessages(
    @Query('channel') channel?: ChatChannel,
    @Query('senderId') senderId?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.chatService.searchMessages(
      { channel, senderId, keyword },
      Number(page),
      Number(limit),
    );
  }

  @Get('messages/stats')
  @ApiOperation({ summary: '频道统计（总消息/今日/独立发言者）' })
  async stats() {
    return this.chatService.getChannelStats();
  }

  @Get('messages/:id')
  @ApiOperation({ summary: '消息详情' })
  async getMessage(@Param('id') id: string) {
    return this.chatService.getMessage(id);
  }

  @Delete('messages/:id')
  @ApiOperation({ summary: '删除消息' })
  async deleteMessage(@Param('id') id: string) {
    const removed = await this.chatService.deleteMessage(id);
    return { removed, id };
  }

  @Post('messages/:id/block')
  @ApiOperation({ summary: '禁言（对消息发送者）' })
  async block(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') messageId: string,
    @Body() body: { durationMinutes: number; reason: string },
  ) {
    const msg = await this.chatService.getMessage(messageId);
    if (!msg) {
      return { success: false, message: '消息不存在' };
    }
    return this.chatService.blockPlayer(
      admin.username,
      msg.senderId,
      Number(body.durationMinutes) || 30,
      body.reason ?? '',
    );
  }
}
