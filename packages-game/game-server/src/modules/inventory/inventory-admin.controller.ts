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
import { InventoryService } from './inventory.service';
import { AdminCreateTemplateDto } from './dto/admin-create-template.dto';
import { AdminUpdateTemplateDto } from './dto/admin-update-template.dto';
import { AdminItemQueryDto } from './dto/admin-item-query.dto';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Inventory')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/inventory')
export class InventoryAdminController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('item-template')
  @ApiOperation({ summary: '道具模板列表' })
  async listTemplates(@Query() query: AdminItemQueryDto) {
    return this.inventoryService.getTemplates(
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get('item-template/:id')
  @ApiOperation({ summary: '道具模板详情' })
  async getTemplate(@Param('id') id: string) {
    return this.inventoryService.getTemplate(id);
  }

  @Post('item-template')
  @ApiOperation({ summary: '创建道具模板' })
  async createTemplate(@Body() body: any) {
    return this.inventoryService.createTemplate(body);
  }

  @Put('item-template/:id')
  @ApiOperation({ summary: '修改道具模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.inventoryService.updateTemplate(id, body);
  }

  @Post('grant')
  @ApiOperation({ summary: 'GM 给玩家发道具' })
  async grant(@Body() body: any) {
    const { playerId, itemTemplateId, quantity, opTrace } = body;
    return this.inventoryService.addItem(
      String(playerId),
      String(itemTemplateId),
      Number(quantity) || 1,
      opTrace ?? 'admin.grant',
    );
  }
}
