import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QuestService } from './quest.service';
import { AdminGuard } from '@common/guards/admin.guard';

/** 任务管理端（admin-web 路由前缀 api/admin/v1/quest） */
@ApiTags('Admin-Quest')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/quest')
export class QuestAdminController {
  constructor(private readonly questService: QuestService) {}

  @Get('template/list')
  @ApiOperation({ summary: '任务模板列表' })
  async listTemplates(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.questService.getTemplates(Number(page), Number(limit));
  }

  @Get('template/:id')
  @ApiOperation({ summary: '任务模板详情' })
  async getTemplate(@Param('id') id: string) {
    return this.questService.getTemplate(id);
  }

  @Post('template')
  @ApiOperation({ summary: '创建任务模板' })
  async createTemplate(@Body() body: any) {
    return this.questService.createTemplate(body);
  }

  @Put('template/:id')
  @ApiOperation({ summary: '修改任务模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.questService.updateTemplate(id, body);
  }

  @Delete('template/:id')
  @ApiOperation({ summary: '删除任务模板' })
  async deleteTemplate(@Param('id') id: string) {
    await this.questService.deleteTemplate(id);
    return { success: true };
  }
}
