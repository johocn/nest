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
import { GiftCodeService } from './giftcode.service';
import { AdminGuard } from '@common/guards/admin.guard';

/** 礼包码管理端（admin-web 路由前缀 api/admin/v1/giftcode） */
@ApiTags('Admin-GiftCode')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/giftcode')
export class GiftCodeAdminController {
  constructor(private readonly giftCodeService: GiftCodeService) {}

  @Get('templates')
  @ApiOperation({ summary: '礼包模板列表' })
  async listTemplates(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.giftCodeService.listTemplates(Number(page), Number(limit));
  }

  @Post('templates')
  @ApiOperation({ summary: '创建礼包模板' })
  async createTemplate(@Body() body: any) {
    return this.giftCodeService.createTemplate(body);
  }

  @Post('templates/:id')
  @ApiOperation({ summary: '更新礼包模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.giftCodeService.updateTemplate(id, body);
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: '软删除礼包模板' })
  async deleteTemplate(@Param('id') id: string) {
    await this.giftCodeService.deleteTemplate(id);
    return { success: true };
  }

  @Post('templates/:id/generate')
  @ApiOperation({ summary: '为模板生成兑换码（批量/规则/固定）' })
  async generate(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    return this.giftCodeService.generate(id, {
      count: body.count,
      customCodes: body.customCodes,
      expiresAt,
    });
  }

  @Get('codes')
  @ApiOperation({ summary: '兑换码列表（可按模板过滤）' })
  async listCodes(
    @Query('templateId') templateId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.giftCodeService.listCodes(templateId, Number(page), Number(limit));
  }

  @Get('redemptions')
  @ApiOperation({ summary: '兑换记录（可按玩家过滤）' })
  async listRedemptions(
    @Query('playerId') playerId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.giftCodeService.listRedemptions(playerId, Number(page), Number(limit));
  }
}
