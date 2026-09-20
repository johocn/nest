import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlayerService } from './player.service';
import { ChangeNicknameDto } from './dto/change-nickname.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';

@ApiTags('Player')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/player')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Get('base-info')
  @ApiOperation({ summary: '获取玩家基础信息' })
  async getBaseInfo(@CurrentPlayer() player: CurrentPlayerData) {
    return this.playerService.getBaseInfo(player.playerId);
  }

  @Post('change-nickname')
  @ApiOperation({ summary: '修改昵称' })
  async changeNickname(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ChangeNicknameDto,
  ) {
    return this.playerService.changeNickname(player.playerId, dto.nickname);
  }

  @Get('protection')
  @ApiOperation({ summary: '新手保护期状态' })
  async getProtection(@CurrentPlayer() player: CurrentPlayerData) {
    return this.playerService.isNewbie(player.playerId);
  }
}
