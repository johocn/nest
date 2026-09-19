import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NoticeService } from './notice.service';
import { CreateNoticeDto } from './dto/create-notice.dto';
import { AdminGuard } from '@common/guards/admin.guard';
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

  // ===== Admin =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/notice/list')
  @ApiOperation({ summary: '公告列表（管理端）' })
  async getNoticeList(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.noticeService.getNoticeList(Number(page), Number(limit));
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/notice/:id')
  @ApiOperation({ summary: '公告详情' })
  async getNotice(@Param('id') id: string) {
    return this.noticeService.getNotice(id);
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/notice')
  @ApiOperation({ summary: '创建公告' })
  async createNotice(@Body() dto: CreateNoticeDto) {
    return this.noticeService.createNotice(dto);
  }

  @UseGuards(AdminGuard)
  @Put('api/admin/v1/notice/:id')
  @ApiOperation({ summary: '修改公告' })
  async updateNotice(
    @Param('id') id: string,
    @Body() dto: Partial<CreateNoticeDto>,
  ) {
    return this.noticeService.updateNotice(id, dto);
  }
}
