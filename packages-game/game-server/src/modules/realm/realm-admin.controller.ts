import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RealmService } from './realm.service';
import { RealmTemplate } from './entities';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Realm')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/realm')
export class RealmAdminController {
  constructor(private readonly realmService: RealmService) {}

  @Get('templates')
  @ApiOperation({ summary: '境界模板列表（按境界升序）' })
  async listTemplates() {
    return { list: await this.realmService.listTemplates() };
  }

  @Post('templates')
  @ApiOperation({ summary: '创建境界模板' })
  async createTemplate(@Body() dto: Partial<RealmTemplate>) {
    return this.realmService.createTemplate(dto);
  }

  @Put('templates/:id')
  @ApiOperation({ summary: '修改境界模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<RealmTemplate>,
  ) {
    return this.realmService.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: '删除境界模板' })
  async removeTemplate(@Param('id') id: string) {
    await this.realmService.removeTemplate(id);
    return { removed: id };
  }
}