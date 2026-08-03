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
import { BuffService } from './buff.service';
import { CreateBuffTemplateDto } from './dto/create-buff-template.dto';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Buff')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/buff')
export class BuffController {
  constructor(private readonly buffService: BuffService) {}

  @Get('template/list')
  @ApiOperation({ summary: 'Buff模板列表' })
  async listTemplates(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.buffService.getTemplates(Number(page), Number(limit));
  }

  @Get('template/:id')
  @ApiOperation({ summary: 'Buff模板详情' })
  async getTemplate(@Param('id') id: string) {
    return this.buffService.getTemplate(id);
  }

  @Post('template')
  @ApiOperation({ summary: '创建Buff模板' })
  async createTemplate(@Body() dto: CreateBuffTemplateDto) {
    return this.buffService.createTemplate(dto);
  }

  @Put('template/:id')
  @ApiOperation({ summary: '修改Buff模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<CreateBuffTemplateDto>,
  ) {
    return this.buffService.updateTemplate(id, dto);
  }
}
