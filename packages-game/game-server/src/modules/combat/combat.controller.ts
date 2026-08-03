import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CombatService } from './combat.service';
import { AdminGuard } from '@common/guards/admin.guard';

@ApiTags('Admin-Combat')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/combat')
export class CombatController {
  constructor(private readonly combatService: CombatService) {}

  @Get('log/:characterId')
  @ApiOperation({ summary: '玩家战斗日志' })
  async getCombatLogs(
    @Param('characterId') characterId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.combatService.getCombatLogs(
      characterId,
      Number(page),
      Number(limit),
    );
  }
}
