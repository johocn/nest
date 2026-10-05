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

/**
 * admin-web ↔ entity 字段映射层
 *
 * admin-web 字段: title / type / scope / priority / isActive / content
 * entity 字段:     title / noticeType(enum) / scope / priority / isActive / content
 *
 * 注意：NoticeType enum(popup/banner/login) 与 admin-web type(announcement/maintenance/activity)
 * 语义不同，这里做简单透传，前端需要对齐 enum 值。
 */

const toEntityPayload = (dto: any): any => {
  const out: any = { ...dto };

  // type → noticeType
  if (dto.type !== undefined) {
    out.noticeType = dto.type;
    delete out.type;
  }

  return out;
};

const fromEntity = (e: any): any => {
  if (!e) return e;
  return {
    ...e,
    type: e.noticeType,
  };
};

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
    const result = await this.noticeService.getNoticeList(
      Number(page),
      Number(limit),
    );
    return {
      ...result,
      items: result.items.map(fromEntity),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '公告详情' })
  async getNotice(@Param('id') id: string) {
    const notice = await this.noticeService.getNotice(id);
    return fromEntity(notice);
  }

  @Post()
  @ApiOperation({ summary: '创建公告' })
  async createNotice(@Body() body: any) {
    const entityPayload = toEntityPayload(body);
    const created = await this.noticeService.createNotice(entityPayload);
    return fromEntity(created);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新公告' })
  async updateNotice(@Param('id') id: string, @Body() body: any) {
    const entityPayload = toEntityPayload(body);
    const updated = await this.noticeService.updateNotice(id, entityPayload);
    return fromEntity(updated);
  }
}
