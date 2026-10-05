import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MailService, SendMailParams } from './mail.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { MailSenderType } from '@constants/enums';

@ApiTags('Admin-Mail')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/mails')
export class MailAdminController {
  constructor(private readonly mailService: MailService) {}

  @Get()
  @ApiOperation({ summary: '邮件列表（按 senderType/recipientId/status 筛选 + 分页）' })
  async list(
    @Query('senderType') senderType?: MailSenderType,
    @Query('recipientId') recipientId?: string,
    @Query('isRead') isRead?: string,
    @Query('isClaimed') isClaimed?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.mailService.listMailsWithFilter(
      {
        senderType,
        recipientId,
        isRead: isRead !== undefined ? isRead === 'true' : undefined,
        isClaimed: isClaimed !== undefined ? isClaimed === 'true' : undefined,
      },
      Number(page),
      Number(limit),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '邮件详情' })
  async get(@Param('id') id: string) {
    return this.mailService.getMail(id);
  }

  @Post()
  @ApiOperation({ summary: '发送系统邮件（可批量：不传 recipientId 则全服）' })
  async create(@Body() body: Partial<SendMailParams> & { recipientId?: string }) {
    const base = {
      senderType: body.senderType ?? MailSenderType.SYSTEM,
      senderId: body.senderId,
      title: body.title!,
      content: body.content!,
      attachmentJson: body.attachmentJson,
      batchId: body.batchId,
      expiredAt: body.expiredAt ? new Date(body.expiredAt as any) : undefined,
    };
    if (body.recipientId) {
      return this.mailService.sendMail({ recipientId: body.recipientId, ...base });
    }
    return this.mailService.sendBatchMail(base);
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑邮件（仅未读未领取的邮件允许编辑）' })
  async update(
    @Param('id') id: string,
    @Body() body: {
      title?: string;
      content?: string;
      attachmentJson?: Record<string, any>;
      expiredAt?: Date;
    },
  ) {
    return this.mailService.updateMail(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除邮件' })
  async remove(@Param('id') id: string) {
    const deleted = await this.mailService.deleteMail(id);
    return { deleted, id };
  }
}
