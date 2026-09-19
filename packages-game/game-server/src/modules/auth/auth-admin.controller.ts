import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ApplyPenaltyDto } from './dto/penalty.dto';
import { AdminGuard } from '@common/guards/admin.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Admin-Auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Roles('super_admin', 'admin', 'operator')
@Controller('api/admin/v1/auth')
export class AuthAdminController {
  constructor(private readonly authService: AuthService) {}

  @Post('penalties')
  @ApiOperation({ summary: 'GM 分级处置（警告/禁言/帮派除名/限交易/封禁）' })
  async applyPenalty(
    @Body() dto: ApplyPenaltyDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return this.authService.applyPenalty(
      admin.username,
      dto.playerId,
      dto.accountId,
      dto.level,
      dto.reason,
      dto.durationSeconds,
    );
  }

  @Get('penalties/:playerId')
  @ApiOperation({ summary: '查询玩家处置记录' })
  async getPenalties(@Param('playerId') playerId: string) {
    return this.authService.getPenalties(playerId);
  }
}
