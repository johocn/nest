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

/**
 * admin-web ↔ entity 字段映射层
 *
 * admin-web batch-send 提交: type / title / content / targetType / targetValue
 * MailService.sendBatchWithTarget 接收: targetType / targetValue / senderType / title / content
 *
 * admin-web type 值: system / activity / compensation / gm
 * MailSenderType:    system / player / admin
 * 映射：system/activity/compensation → SYSTEM；gm → ADMIN
 */

const ADMIN_TYPE_TO_SENDER: Record<string, MailSenderType> = {
  system: MailSenderType.SYSTEM,
  activity: MailSenderType.SYSTEM,
  compensation: MailSenderType.SYSTEM,
  gm: MailSenderType.ADMIN,
};

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
    @Body()
    body: {
      playerId: string;
      title: string;
      type?: string;
      content: string;
    },
  ) {
    const senderType = ADMIN_TYPE_TO_SENDER[body.type ?? ''] ?? MailSenderType.ADMIN;
    return this.mailService.sendMail({
      recipientId: String(body.playerId),
      senderType,
      title: body.title,
      content: body.content,
    });
  }

  @Post('batch-send')
  @ApiOperation({ summary: '批量发送邮件（全服/按等级/按VIP/指定玩家ID/在线）' })
  async batchSendMail(
    @Body()
    body: {
      type?: string;
      targetType: 'all' | 'online' | 'level' | 'vip' | 'playerIds';
      targetValue?: string;
      title: string;
      content: string;
    },
  ) {
    const senderType = ADMIN_TYPE_TO_SENDER[body.type ?? ''] ?? MailSenderType.SYSTEM;
    return this.mailService.sendBatchWithTarget({
      senderType,
      targetType: body.targetType,
      targetValue: body.targetValue,
      title: body.title,
      content: body.content,
    });
  }
}
