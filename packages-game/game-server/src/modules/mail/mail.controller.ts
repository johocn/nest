import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MailService } from './mail.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
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
}
