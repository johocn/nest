import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SocialEconomyService } from './social-economy.service';
import { AdminAdjustPointsDto } from './dto/admin-adjust-points.dto';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Admin-Social')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/social/points')
export class SocialAdminController {
  constructor(private readonly socialEconomyService: SocialEconomyService) {}

  @Put(':playerId')
  @ApiOperation({ summary: 'GM补发/回收社交积分（原因 ADMIN，流水留痕）' })
  async adjustPoints(
    @Param('playerId') playerId: string,
    @Body() dto: AdminAdjustPointsDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return {
      playerId,
      balance: await this.socialEconomyService.adminAdjustPoints(
        playerId,
        dto.delta,
        admin.username,
        dto.note,
      ),
    };
  }
}