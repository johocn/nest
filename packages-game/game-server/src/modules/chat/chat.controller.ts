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
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import {
  SupportTicketStatus,
  VoiceRoomType,
} from '@constants/enums';

@ApiTags('Chat')
@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ===== 频道签到 / 等级（14.8）=====

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/chat/sign-in')
  @ApiOperation({ summary: '频道签到（世界频道当日首条发言自动触发）' })
  async signIn(@CurrentPlayer() player: CurrentPlayerData) {
    return this.chatService.channelSignIn(player.playerId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/chat/sign-in/status')
  @ApiOperation({ summary: '今日签到状态' })
  async signInStatus(@CurrentPlayer() player: CurrentPlayerData) {
    return this.chatService.getSignInStatus(player.playerId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/chat/my-stats')
  @ApiOperation({ summary: '我的频道发言统计与等级' })
  async myStats(@CurrentPlayer() player: CurrentPlayerData) {
    return this.chatService.getMyChatStats(player.playerId);
  }

  // ===== 江湖热搜（14.9）=====

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/chat/hot-topics')
  @ApiOperation({ summary: '江湖热搜（话题标签 + 玩家提及）' })
  async hotTopics(@Query('days') days = 1) {
    return this.chatService.getHotTopics(Number(days));
  }

  // ===== 客服引导（14.11）=====

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/chat/support/my')
  @ApiOperation({ summary: '我的客服工单' })
  async myTickets(@CurrentPlayer() player: CurrentPlayerData) {
    return this.chatService.getMyTickets(player.playerId);
  }

  // ===== 语音房（14.12，骨架）=====

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/chat/voice-room')
  @ApiOperation({ summary: '创建语音房' })
  async createVoiceRoom(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() body: { roomName: string; roomType: VoiceRoomType; maxMembers?: number },
  ) {
    return this.chatService.createVoiceRoom(
      player.playerId,
      body.roomName,
      body.roomType,
      body.maxMembers,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/chat/voice-room/:id/join')
  @ApiOperation({ summary: '加入语音房' })
  async joinVoiceRoom(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.chatService.joinVoiceRoom(player.playerId, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/chat/voice-room/:id/leave')
  @ApiOperation({ summary: '离开语音房（空房自动删除）' })
  async leaveVoiceRoom(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.chatService.leaveVoiceRoom(player.playerId, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/chat/voice-rooms')
  @ApiOperation({ summary: '语音房列表' })
  async voiceRooms(@Query('roomType') roomType?: VoiceRoomType) {
    return this.chatService.getVoiceRooms(roomType);
  }

  // ===== Admin =====

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('api/admin/v1/chat/log/list')
  @ApiOperation({ summary: '聊天记录列表' })
  async getChatLogs(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.chatService.getChatLogList(Number(page), Number(limit));
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/chat/lucky-star/draw')
  @ApiOperation({ summary: '抽取频道幸运星（GM审计留痕）' })
  async drawLuckyStar(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Query('count') count = 3,
    @Query('days') days = 1,
  ) {
    return this.chatService.drawLuckyStar(
      admin.adminId,
      Number(count),
      Number(days),
    );
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('api/admin/v1/chat/support/list')
  @ApiOperation({ summary: '客服工单列表' })
  async listTickets(
    @Query('status') status?: SupportTicketStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.chatService.listTickets(
      status,
      Number(page),
      Number(limit),
    );
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/chat/support/:id/reply')
  @ApiOperation({ summary: 'GM回复工单（回复后关闭）' })
  async replyTicket(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('id') id: string,
    @Body() body: { reply: string },
  ) {
    return this.chatService.replyTicket(admin.adminId, id, body.reply);
  }
}
