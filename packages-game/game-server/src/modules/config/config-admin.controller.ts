import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigManageService } from './config.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

/** 配置管理端（admin-web 路由前缀 api/admin/v1/config） */
@ApiTags('Admin-Config')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/config')
export class ConfigAdminController {
  constructor(private readonly configService: ConfigManageService) {}

  @Get('list')
  @ApiOperation({ summary: '配置列表' })
  async getConfigList(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.configService.getConfigList(Number(page), Number(limit));
  }

  @Post()
  @ApiOperation({ summary: '设置配置（创建/更新，写版本历史）' })
  async setConfig(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Body() body: any,
  ) {
    return this.configService.setConfig(
      body.key,
      body.value,
      body.configType,
      body.description,
      admin.adminId,
    );
  }

  @Get(':key/versions')
  @ApiOperation({ summary: '配置版本历史' })
  async getConfigVersions(
    @Param('key') key: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.configService.listConfigVersions(
      key,
      Number(page),
      Number(limit),
    );
  }

  @Post(':key/rollback')
  @ApiOperation({ summary: '配置版本回滚' })
  async rollbackConfig(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('key') key: string,
    @Body() body: any,
  ) {
    return this.configService.rollbackConfig(admin.adminId, key, body.version);
  }

  @Delete(':key')
  @ApiOperation({ summary: '删除配置' })
  async deleteConfig(@Param('key') key: string) {
    await this.configService.deleteConfig(key);
    return { success: true };
  }
}
