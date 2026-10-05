import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkillService } from './skill.service';
import { CharacterService } from '@modules/character/character.service';
import { SkillTemplate } from './entities';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

/** 玩家端技能操作 —— 放技能 + 查可用技能 + 查冷却 */
@ApiTags('Skill')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/skill')
export class SkillClientController {
  constructor(
    private readonly skillService: SkillService,
    private readonly characterService: CharacterService,
  ) {}

  private async resolveCharacterId(playerId: string): Promise<string> {
    const c = await this.characterService.getByPlayerId(playerId);
    if (!c) throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    return c.id;
  }

  @Post('cast')
  @ApiOperation({
    summary: '施放技能',
    description: 'attacker 自动取当前玩家角色；defenderCharacterId/baseStats/currentMp 由前端传入',
  })
  async cast(
    @CurrentPlayer() p: CurrentPlayerData,
    @Body() body: any,
  ) {
    const attackerId = await this.resolveCharacterId(p.playerId);
    return this.skillService.castSkill(
      attackerId,
      body.skillTemplateId,
      body.defenderCharacterId,
      body.baseStats,
      body.currentMp,
    );
  }

  @Get('available')
  @ApiOperation({ summary: '查询可用技能模板列表' })
  async available(@CurrentPlayer() p: CurrentPlayerData) {
    const list: SkillTemplate[] = await this.skillService['skillRepo'].find();
    return list;
  }

  @Post('cooldown')
  @ApiOperation({ summary: '查询技能是否在冷却中' })
  async cooldown(
    @CurrentPlayer() p: CurrentPlayerData,
    @Body() body: any,
  ) {
    const characterId = await this.resolveCharacterId(p.playerId);
    const onCd = await this.skillService.checkCooldown(
      characterId,
      body.skillTemplateId,
    );
    return { onCooldown: onCd };
  }
}
