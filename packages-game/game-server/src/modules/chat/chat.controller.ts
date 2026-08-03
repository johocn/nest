import { Body, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Chat')
@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ===== Admin =====

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('api/admin/v1/chat/log/list')
  @ApiOperation({ summary: '聊天记录列表' })
  async getChatLogs(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.chatService.getChatLogList(Number(page), Number(limit));
  }
}
