import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VipService } from './vip.service';
import { AdminGuard } from '@common/guards/admin.guard';

/**
 * admin-web ↔ entity 字段映射层
 *
 * admin-web 字段: level / name / requiredExp / multiplier / isActive / benefits
 * entity 字段:     level / name / requiredExp / multiplier / isActive / privilegeJson
 */

const isJsonObject = (v: any): boolean =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const toEntityPayload = (dto: any): any => {
  const out: any = { ...dto };

  // benefits → privilegeJson
  if (dto.benefits !== undefined) {
    out.privilegeJson = isJsonObject(dto.benefits) ? dto.benefits : {};
    delete out.benefits;
  }

  return out;
};

const fromEntity = (e: any): any => {
  if (!e) return e;
  return {
    ...e,
    benefits: e.privilegeJson,
  };
};

/** VIP 配置 CRUD（admin-web 路由前缀 api/admin/v1/vip） */
@ApiTags('Admin-VIP')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/vip')
export class VipAdminController {
  constructor(private readonly vipService: VipService) {}

  @Get('config/list')
  @ApiOperation({ summary: 'VIP 配置列表' })
  async listConfigs() {
    const list = await this.vipService.getConfigList();
    return list.map(fromEntity);
  }

  @Post('config')
  @ApiOperation({ summary: '创建 VIP 配置' })
  async createConfig(@Body() body: any) {
    const entityPayload = toEntityPayload(body);
    const created = await this.vipService.createConfig(entityPayload);
    return fromEntity(created);
  }

  @Patch('config/:level')
  @ApiOperation({ summary: '更新 VIP 配置' })
  async updateConfig(
    @Param('level') level: string,
    @Body() body: any,
  ) {
    const entityPayload = toEntityPayload(body);
    const updated = await this.vipService.updateConfig(Number(level), entityPayload);
    return fromEntity(updated);
  }

  @Delete('config/:level')
  @ApiOperation({ summary: '删除 VIP 配置' })
  async deleteConfig(@Param('level') level: string) {
    return this.vipService.deleteConfig(Number(level));
  }
}
