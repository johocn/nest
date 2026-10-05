import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MailService } from './mail.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { MailSenderType } from '@constants/enums';

/** 邮件列表 + 发送/批量发送（admin-web 路由前缀 api/admin/v1/mail） */
@ApiTags('Admin-Mail')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/mail')
export class MailAdminController {
  constructor(private readonly mailService: MailService) {}

  @Get('list')
  @ApiOperation({ summary: '邮件列表（支持 senderType/recipientId/isRead/isClaimed + 分页）' })
  async listMails(
    @Query('senderType') senderType?: string,
    @Query('recipientId') recipientId?: string,
    @Query('isRead') isRead?: string,
    @Query('isClaimed') isClaimed?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.mailService.listMailsWithFilter(
      {
        senderType: senderType as MailSenderType | undefined,
        recipientId,
        isRead: isRead !== undefined ? isRead === 'true' : undefined,
        isClaimed: isClaimed !== undefined ? isClaimed === 'true' : undefined,
      },
      Number(page),
      Number(limit),
    );
  }

  @Post('send')
  @ApiOperation({ summary: '发送单封邮件' })
  async sendMail(
    @Body() body: {
      playerId: string;
      title: string;
      type?: MailSenderType;
      content: string;
    },
  ) {
    return this.mailService.sendMail({
      recipientId: String(body.playerId),
      senderType: body.type ?? MailSenderType.ADMIN,
      title: body.title,
      content: body.content,
    });
  }

  @Post('batch-send')
  @ApiOperation({ summary: '批量发送邮件（全服/按等级/按VIP/指定玩家ID）' })
  async batchSendMail(
    @Body()
    body: {
      targetType: string;
      targetValue?: string;
      title: string;
      type?: MailSenderType;
      content: string;
    },
  ) {
    // 批量逻辑简化：仅向在线玩家发送（服务端现有 sendBatchMail 实现）
    // 按等级/VIP/指定玩家ID 可后续扩展
    return this.mailService.sendBatchMail({
      senderType: body.type ?? MailSenderType.ADMIN,
      title: body.title,
      content: body.content,
    });
  }
}
