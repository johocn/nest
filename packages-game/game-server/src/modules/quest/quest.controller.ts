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
import { QuestService } from './quest.service';
import { AcceptQuestDto } from './dto/accept-quest.dto';
import { CreateQuestTemplateDto } from './dto/create-quest-template.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Quest')
@ApiBearerAuth()
@Controller()
export class QuestController {
  constructor(private readonly questService: QuestService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/quest/list')
  @ApiOperation({ summary: '玩家任务列表' })
  async listQuests(@CurrentPlayer() player: CurrentPlayerData) {
    return this.questService.listPlayerQuests(player.playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/quest/accept')
  @ApiOperation({ summary: '接取任务' })
  async acceptQuest(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: AcceptQuestDto,
  ) {
    return this.questService.acceptQuest(player.playerId, dto.questTemplateId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/quest/submit')
  @ApiOperation({ summary: '提交任务领奖' })
  async submitQuest(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: AcceptQuestDto,
  ) {
    return this.questService.submitQuest(player.playerId, dto.questTemplateId);
  }

  // ===== Admin =====

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/quest/template/list')
  @ApiOperation({ summary: '任务模板列表' })
  async listTemplates(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.questService.getTemplates(Number(page), Number(limit));
  }

  @UseGuards(AdminGuard)
  @Get('api/admin/v1/quest/template/:id')
  @ApiOperation({ summary: '任务模板详情' })
  async getTemplate(@Param('id') id: string) {
    return this.questService.getTemplate(id);
  }

  @UseGuards(AdminGuard)
  @Post('api/admin/v1/quest/template')
  @ApiOperation({ summary: '创建任务模板' })
  async createTemplate(@Body() dto: CreateQuestTemplateDto) {
    return this.questService.createTemplate(dto);
  }

  @UseGuards(AdminGuard)
  @Put('api/admin/v1/quest/template/:id')
  @ApiOperation({ summary: '修改任务模板' })
  async updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<CreateQuestTemplateDto>,
  ) {
    return this.questService.updateTemplate(id, dto);
  }
}
