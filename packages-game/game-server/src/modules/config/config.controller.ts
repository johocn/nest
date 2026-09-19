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
import { SetConfigDto } from './dto/set-config.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Config')
@ApiBearerAuth()
@Controller()
export class ConfigController {
  constructor(private readonly configService: ConfigManageService) {}

  // ===== Client (read-only) =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/config/:key')
  @ApiOperation({ summary: '获取配置值' })
  async getConfig(@Param('key') key: string) {
    return this.configService.getConfig(key);
  }

  // ===== Admin =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/config/list')
  @ApiOperation({ summary: '配置列表' })
  async getConfigList(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.configService.getConfigList(Number(page), Number(limit));
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/config')
  @ApiOperation({ summary: '设置配置（创建/更新，写版本历史）' })
  async setConfig(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Body() dto: SetConfigDto,
  ) {
    return this.configService.setConfig(
      dto.key,
      dto.value,
      dto.configType,
      dto.description,
      admin.adminId,
    );
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/config/:key/versions')
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

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/config/:key/rollback')
  @ApiOperation({ summary: '配置版本回滚' })
  async rollbackConfig(
    @CurrentAdmin() admin: AdminJwtPayload,
    @Param('key') key: string,
    @Body() body: { version: number },
  ) {
    return this.configService.rollbackConfig(admin.adminId, key, body.version);
  }

  @UseGuards(AdminGuard)
  @Delete('api/admin/v1/config/:key')
  @ApiOperation({ summary: '删除配置' })
  async deleteConfig(@Param('key') key: string) {
    await this.configService.deleteConfig(key);
    return { success: true };
  }
}
