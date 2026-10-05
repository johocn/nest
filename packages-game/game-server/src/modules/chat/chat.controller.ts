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
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { VoiceRoomType } from '@constants/enums';

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
  @Post('api/client/v1/chat/sign-in/makeup')
  @ApiOperation({ summary: '签到补签（消耗社交积分）' })
  async makeupSignIn(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: { date: string },
  ) {
    return this.chatService.makeupSignIn(player.playerId, dto.date);
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
}
