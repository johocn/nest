import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RealmService } from './realm.service';
import { CultivateDto } from './dto/cultivate.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Realm')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/realm')
export class RealmController {
  constructor(private readonly realmService: RealmService) {}

  @Get('my')
  @ApiOperation({ summary: '我的境界（境界/修为/下一档模板）' })
  async getMy(@CurrentPlayer() player: CurrentPlayerData) {
    return this.realmService.getRealmInfo(player.playerId);
  }

  @Post('cultivate')
  @ApiOperation({ summary: '投入修为（日常玩法产出）' })
  async cultivate(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CultivateDto,
  ) {
    return this.realmService.cultivate(player.playerId, dto.amount);
  }

  @Post('breakthrough')
  @ApiOperation({ summary: '境界突破（达标→消耗→升级→里程碑发奖）' })
  async breakthrough(@CurrentPlayer() player: CurrentPlayerData) {
    return this.realmService.breakThrough(player.playerId);
  }
}