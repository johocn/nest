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
import { DropService } from './drop.service';
import { CreateDropTemplateDto } from './dto/create-drop-template.dto';
import { RollDropDto } from './dto/roll-drop.dto';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-ItemDrop')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/item-drop')
export class DropController {
  constructor(private readonly dropService: DropService) {}

  @Get('template/list')
  @ApiOperation({ summary: '掉落模板列表' })
  async listTemplates(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.dropService.getDropTemplates(Number(page), Number(limit));
  }

  @Get('template/:id')
  @ApiOperation({ summary: '掉落模板详情' })
  async getTemplate(@Param('id') id: string) {
    return this.dropService.getDropTemplate(id);
  }

  @Post('template')
  @ApiOperation({ summary: '创建掉落模板' })
  async createTemplate(@Body() dto: CreateDropTemplateDto) {
    return this.dropService.createDropTemplate(dto);
  }

  @Put('template/:id')
  @ApiOperation({ summary: '修改掉落模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<CreateDropTemplateDto>,
  ) {
    return this.dropService.updateDropTemplate(id, dto);
  }

  @Post('roll')
  @ApiOperation({ summary: '触发掉落（GM测试用）' })
  async rollDrop(@Body() dto: RollDropDto) {
    return this.dropService.rollDrop(dto.playerId, dto.dropTemplateId);
  }
}
