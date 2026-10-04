import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GiftCodeService } from './giftcode.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';

@ApiTags('GiftCode')
@Controller()
export class GiftCodeController {
  constructor(private readonly giftCodeService: GiftCodeService) {}

  // ===== Client: 玩家兑换 =====

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/giftcode/redeem')
  @ApiBearerAuth()
  @ApiOperation({ summary: '玩家兑换礼包码' })
  async redeem(
    @CurrentPlayer('playerId') playerId: string,
    @Body() body: { code: string },
  ) {
    return this.giftCodeService.redeem(playerId, body.code);
  }

  // ===== Admin: 模板 CRUD + 生成 + 查询 =====

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('api/admin/v1/giftcode/templates')
  @ApiOperation({ summary: '礼包模板列表' })
  async listTemplates(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.giftCodeService.listTemplates(Number(page), Number(limit));
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/giftcode/templates')
  @ApiOperation({ summary: '创建礼包模板' })
  async createTemplate(@Body() body: any) {
    return this.giftCodeService.createTemplate(body);
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/giftcode/templates/:id')
  @ApiOperation({ summary: '更新礼包模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.giftCodeService.updateTemplate(id, body);
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/giftcode/templates/:id/delete')
  @ApiOperation({ summary: '软删除礼包模板' })
  async deleteTemplate(@Param('id') id: string) {
    await this.giftCodeService.deleteTemplate(id);
    return { success: true };
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post('api/admin/v1/giftcode/templates/:id/generate')
  @ApiOperation({ summary: '为模板生成兑换码（批量/规则/固定）' })
  async generate(
    @Param('id') id: string,
    @Body() body: {
      count?: number;
      customCodes?: string[];
      expiresAt?: string;
    },
  ) {
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    return this.giftCodeService.generate(id, {
      count: body.count,
      customCodes: body.customCodes,
      expiresAt,
    });
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('api/admin/v1/giftcode/codes')
  @ApiOperation({ summary: '兑换码列表（可按模板过滤）' })
  async listCodes(
    @Query('templateId') templateId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.giftCodeService.listCodes(templateId, Number(page), Number(limit));
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get('api/admin/v1/giftcode/redemptions')
  @ApiOperation({ summary: '兑换记录（可按玩家过滤）' })
  async listRedemptions(
    @Query('playerId') playerId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.giftCodeService.listRedemptions(playerId, Number(page), Number(limit));
  }
}
