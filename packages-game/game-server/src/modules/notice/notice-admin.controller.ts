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
import { AdminGuard } from '@common/guards/admin.guard';

/** 公告 CRUD（admin-web 路由前缀 api/admin/v1/notice） */
@ApiTags('Admin-Notice')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/notice')
export class NoticeAdminController {
  constructor(private readonly noticeService: NoticeService) {}

  @Get('list')
  @ApiOperation({ summary: '公告列表（支持 type/isActive + 分页）' })
  async listNotices(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.noticeService.getNoticeList(Number(page), Number(limit));
  }

  @Get(':id')
  @ApiOperation({ summary: '公告详情' })
  async getNotice(@Param('id') id: string) {
    return this.noticeService.getNotice(id);
  }

  @Post()
  @ApiOperation({ summary: '创建公告' })
  async createNotice(@Body() body: any) {
    return this.noticeService.createNotice(body);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新公告' })
  async updateNotice(@Param('id') id: string, @Body() body: any) {
    return this.noticeService.updateNotice(id, body);
  }
}
