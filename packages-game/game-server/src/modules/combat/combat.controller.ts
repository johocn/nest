import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CombatService } from './combat.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Combat')
@ApiBearerAuth()
@Controller()
export class CombatController {
  constructor(private readonly combatService: CombatService) {}

  // ===== Client =====

  @UseGuards(JwtAuthGuard)
  @Get('api/client/v1/combat/log')
  @ApiOperation({ summary: '我的战斗日志' })
  async getCombatLogs(
    @CurrentPlayer() player: CurrentPlayerData,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.combatService.getCombatLogs(
      player.playerId,
      Number(page),
      Number(limit),
    );
  }
}
