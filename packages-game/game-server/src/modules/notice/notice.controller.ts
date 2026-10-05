import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NoticeService } from './notice.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { NoticeReactionType } from '@constants/enums';

@ApiTags('Notice')
@ApiBearerAuth()
@Controller()
export class NoticeController {
  constructor(private readonly noticeService: NoticeService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/notice/list')
  @ApiOperation({ summary: '登录公告列表' })
  async getActiveNotices() {
    return this.noticeService.getActiveNotices();
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/notice/:id/react')
  @ApiOperation({ summary: '公告互动（点赞/回执）' })
  async react(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
    @Body() body: { type: NoticeReactionType },
  ) {
    return this.noticeService.react(id, player.playerId, body.type);
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/notice/:id/reactions')
  @ApiOperation({ summary: '公告互动计数' })
  async getReactions(@Param('id') id: string) {
    return this.noticeService.getReactions(id);
  }
}
