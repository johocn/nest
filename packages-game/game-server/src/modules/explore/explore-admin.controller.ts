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
import { ExploreService } from './explore.service';
import { EncounterTemplate } from './entities';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Explore')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/explore')
export class ExploreAdminController {
  constructor(private readonly exploreService: ExploreService) {}

  @Get('templates')
  @ApiOperation({ summary: '奇遇模板列表' })
  async listTemplates() {
    return { list: await this.exploreService.listTemplates() };
  }

  @Post('templates')
  @ApiOperation({ summary: '创建奇遇模板' })
  async createTemplate(@Body() dto: Partial<EncounterTemplate>) {
    return this.exploreService.createTemplate(dto);
  }

  @Put('templates/:id')
  @ApiOperation({ summary: '修改奇遇模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<EncounterTemplate>,
  ) {
    return this.exploreService.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: '删除奇遇模板' })
  async removeTemplate(@Param('id') id: string) {
    await this.exploreService.removeTemplate(id);
    return { removed: id };
  }
}