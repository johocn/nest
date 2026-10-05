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
 * NoticeType enum(popup/banner/login) 与 admin-web type(announcement/maintenance/activity)
 * 不同，这里做双向值映射，避免 Postgres enum 插入报错。
 */

/** admin-web type → NoticeType enum 的映射 */
const TYPE_TO_ENUM: Record<string, string> = {
  announcement: 'popup',   // 公告 → 弹窗
  maintenance: 'banner',   // 维护 → 横幅
  activity: 'login',       // 活动 → 登录公告
};

/** NoticeType enum → admin-web type 的反向映射 */
const ENUM_TO_TYPE: Record<string, string> = {
  popup: 'announcement',
  banner: 'maintenance',
  login: 'activity',
};

const toEntityPayload = (dto: any): any => {
  const out: any = { ...dto };

  // type → noticeType（经过值映射）
  if (dto.type !== undefined) {
    out.noticeType = TYPE_TO_ENUM[dto.type] ?? dto.type; // 未知值透传
    delete out.type;
  }

  return out;
};

const fromEntity = (e: any): any => {
  if (!e) return e;
  return {
    ...e,
    type: ENUM_TO_TYPE[e.noticeType] ?? e.noticeType,
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
