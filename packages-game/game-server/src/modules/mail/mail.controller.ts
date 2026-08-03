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
import { MailService } from './mail.service';
import { SendMailDto, SendBatchMailDto } from './dto/send-mail.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Mail')
@ApiBearerAuth()
@Controller()
export class MailController {
  constructor(private readonly mailService: MailService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/mail/list')
  @ApiOperation({ summary: '邮件列表' })
  async getMails(@CurrentPlayer() player: CurrentPlayerData) {
    return this.mailService.getMails(player.playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/mail/:id/read')
  @ApiOperation({ summary: '标记已读' })
  async readMail(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.mailService.readMail(player.playerId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/mail/:id/claim')
  @ApiOperation({ summary: '领取附件' })
  async claimAttachment(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.mailService.claimAttachment(player.playerId, id);
  }

  // ===== Admin =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/mail/list')
  @ApiOperation({ summary: '邮件列表（管理端）' })
  async getMailList(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.mailService.getMailList(Number(page), Number(limit));
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/mail/send')
  @ApiOperation({ summary: '发送邮件' })
  async sendMail(@Body() dto: SendMailDto) {
    return this.mailService.sendMail({
      recipientId: dto.recipientId!,
      senderType: dto.senderType,
      title: dto.title,
      content: dto.content,
      attachmentJson: dto.attachmentJson,
    });
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/mail/batch-send')
  @ApiOperation({ summary: '全服邮件' })
  async sendBatchMail(@Body() dto: SendBatchMailDto) {
    return this.mailService.sendBatchMail({
      senderType: dto.senderType,
      title: dto.title,
      content: dto.content,
      attachmentJson: dto.attachmentJson,
    });
  }
}
