import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EconomyService } from './economy.service';
import { AdminCurrencyDto } from './dto/admin-currency.dto';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';

@ApiTags('Admin-Economy')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/player/:id/currency')
export class EconomyController {
  constructor(private readonly economyService: EconomyService) {}

  @Put()
  @ApiOperation({ summary: 'GM增减玩家货币' })
  async adjustCurrency(
    @Param('id') playerId: string,
    @Body() dto: AdminCurrencyDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const opTrace = `gm:${admin.username}`;
    if (dto.operation === 'add') {
      return this.economyService.addCurrency(
        playerId,
        dto.currencyType,
        dto.amount,
        'admin',
        opTrace,
        dto.reason,
      );
    } else {
      return this.economyService.deductCurrency(
        playerId,
        dto.currencyType,
        dto.amount,
        'admin',
        opTrace,
        dto.reason,
      );
    }
  }
}
