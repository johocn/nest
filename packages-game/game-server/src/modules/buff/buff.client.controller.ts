import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BuffService } from './buff.service';
import { CharacterService } from '@modules/character/character.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/** 玩家端 Buff 运行时操作 —— 触发/查询/移除 active buff + 查看修正后属性 */
@ApiTags('Buff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/buff')
export class BuffClientController {
  constructor(
    private readonly buffService: BuffService,
    private readonly characterService: CharacterService,
  ) {}

  private async resolveCharacterId(playerId: string): Promise<string> {
    const c = await this.characterService.getByPlayerId(playerId);
    if (!c) throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    return c.id;
  }

  @Post('apply')
  @ApiOperation({ summary: '触发 Buff（玩家端主动/战斗系统调用）' })
  async apply(
    @CurrentPlayer() p: CurrentPlayerData,
    @Body() body: any,
  ) {
    const characterId = await this.resolveCharacterId(p.playerId);
    return this.buffService.applyBuff(characterId, body.buffTemplateId);
  }

  @Get('active')
  @ApiOperation({ summary: '查询当前角色所有 active buff' })
  async listActive(@CurrentPlayer() p: CurrentPlayerData) {
    const characterId = await this.resolveCharacterId(p.playerId);
    return this.buffService.getActiveBuffs(characterId);
  }

  @Delete(':buffTemplateId')
  @ApiOperation({ summary: '主动移除某个 buff' })
  async remove(
    @CurrentPlayer() p: CurrentPlayerData,
    @Param('buffTemplateId') buffTemplateId: string,
  ) {
    const characterId = await this.resolveCharacterId(p.playerId);
    await this.buffService.removeBuff(characterId, buffTemplateId);
    return { success: true };
  }

  @Post('stats')
  @ApiOperation({ summary: '计算 buff 修正后的角色属性' })
  async stats(
    @CurrentPlayer() p: CurrentPlayerData,
    @Body() body: any,
  ) {
    const characterId = await this.resolveCharacterId(p.playerId);
    return this.buffService.calculateModifiedStats(characterId, body.baseStats);
  }
}
