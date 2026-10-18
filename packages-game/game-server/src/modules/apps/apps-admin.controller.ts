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
import { AppsAdminService } from './apps-admin.service';
import { AdminGuard } from '@common/guards/admin.guard';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/** apps 管理端（admin-web 路由前缀 api/admin/v1/apps） */
@ApiTags('Admin-Apps')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/apps')
export class AppsAdminController {
  constructor(private readonly appsAdminService: AppsAdminService) {}

  private assertId(id: string): string {
    if (!/^\d+$/.test(id)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return id;
  }

  @Get()
  @ApiOperation({ summary: 'app 列表' })
  async list(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.appsAdminService.list(Number(page), Number(limit));
  }

  @Get(':id')
  @ApiOperation({ summary: 'app 详情' })
  async get(@Param('id') id: string) {
    return this.appsAdminService.get(this.assertId(id));
  }

  @Post()
  @ApiOperation({ summary: '创建 app（自动生成 apiKey）' })
  async create(@Body() body: any) {
    return this.appsAdminService.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: '修改 app（仅 name/isActive）' })
  async update(@Param('id') id: string, @Body() body: any) {
    return this.appsAdminService.update(this.assertId(id), body);
  }

  @Post(':id/rotate-key')
  @ApiOperation({ summary: '重置接入凭证（返回新 apiKey）' })
  async rotateKey(@Param('id') id: string) {
    return this.appsAdminService.rotateKey(this.assertId(id));
  }
}
