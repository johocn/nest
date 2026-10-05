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
import { NoticeService } from './notice.service';
import { CreateNoticeDto } from './dto/create-notice.dto';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Admin-Notice')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/notices')
export class NoticeAdminController {
  constructor(private readonly noticeService: NoticeService) {}

  @Get()
  @ApiOperation({ summary: '公告列表（分页）' })
  async list(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.noticeService.getNoticeList(Number(page), Number(limit));
  }

  @Get(':id')
  @ApiOperation({ summary: '公告详情' })
  async get(@Param('id') id: string) {
    return this.noticeService.getNotice(id);
  }

  @Post()
  @ApiOperation({ summary: '创建公告' })
  async create(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Body() dto: CreateNoticeDto,
  ) {
    return this.noticeService.createNotice({ ...dto, createdBy: admin.adminId });
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新公告' })
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateNoticeDto>,
  ) {
    return this.noticeService.updateNotice(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除公告' })
  async remove(@Param('id') id: string) {
    await this.noticeService.deleteNotice(id);
    return { removed: id };
  }
}
