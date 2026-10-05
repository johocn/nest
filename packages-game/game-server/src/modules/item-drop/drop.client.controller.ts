import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DropService } from './drop.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

/** 玩家端掉落操作 —— 触发掉落 roll + 查掉落表详情 */
@ApiTags('Drop')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/drop')
export class DropClientController {
  constructor(private readonly dropService: DropService) {}

  @Post('roll')
  @ApiOperation({
    summary: '触发一次掉落（自动入背包）',
    description: 'playerId 自动取当前用户；rollDrop 内部已调 inventoryService.addItem',
  })
  async roll(
    @CurrentPlayer() p: CurrentPlayerData,
    @Body() body: any,
  ) {
    return this.dropService.rollDrop(p.playerId, body.dropTemplateId);
  }

  @Get('template/:id')
  @ApiOperation({ summary: '查询掉落表详情（玩家端可看掉落配置）' })
  async getTemplate(@Param('id') id: string) {
    return this.dropService.getDropTemplate(id);
  }

  @Get('templates')
  @ApiOperation({ summary: '查询掉落表列表（分页）' })
  async list(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.dropService.getDropTemplates(Number(page), Number(limit));
  }
}
