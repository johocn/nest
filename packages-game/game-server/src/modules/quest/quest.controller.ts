import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QuestService } from './quest.service';
import { AcceptQuestDto } from './dto/accept-quest.dto';
import { QuestHelpDto } from './dto/quest-help.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@ApiTags('Quest')
@ApiBearerAuth()
@Controller()
export class QuestController {
  constructor(private readonly questService: QuestService) {}

  private assertId(id: string): string {
    if (!/^\d+$/.test(id)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return id;
  }

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

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/quest/claim')
  @ApiOperation({ summary: '领取任务奖励（auto_reward=false 的任务）' })
  async claimQuestReward(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: AcceptQuestDto,
  ) {
    return this.questService.claimQuestReward(
      player.playerId,
      dto.questTemplateId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/quest/help/request')
  @ApiOperation({ summary: '发起卡关求助' })
  async requestHelp(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: QuestHelpDto,
  ) {
    return this.questService.requestHelp(
      player.playerId,
      this.assertId(dto.questTemplateId),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/quest/help/mine')
  @ApiOperation({ summary: '我的求助与可协助列表' })
  async listHelpRequests(@CurrentPlayer() player: CurrentPlayerData) {
    return this.questService.listHelpRequests(player.playerId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/client/v1/quest/help/:id/respond')
  @ApiOperation({ summary: '协助他人任务' })
  async respondHelp(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.questService.respondHelp(player.playerId, this.assertId(id));
  }
}
