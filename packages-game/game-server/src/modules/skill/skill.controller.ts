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
import { SkillService } from './skill.service';
import { CreateSkillTemplateDto } from './dto/create-skill-template.dto';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Skill')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/skill')
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Get('template/list')
  @ApiOperation({ summary: '技能模板列表' })
  async listTemplates(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.skillService.getTemplates(Number(page), Number(limit));
  }

  @Get('template/:id')
  @ApiOperation({ summary: '技能模板详情' })
  async getTemplate(@Param('id') id: string) {
    return this.skillService.getTemplate(id);
  }

  @Post('template')
  @ApiOperation({ summary: '创建技能模板' })
  async createTemplate(@Body() dto: CreateSkillTemplateDto) {
    return this.skillService.createTemplate(dto);
  }

  @Put('template/:id')
  @ApiOperation({ summary: '修改技能模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<CreateSkillTemplateDto>,
  ) {
    return this.skillService.updateTemplate(id, dto);
  }
}
