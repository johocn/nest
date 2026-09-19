import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { FormationService } from './formation.service';
import { RescueService } from './rescue.service';
import { FaceService } from './face.service';
import { LootService } from './loot.service';
import { ArbitrationService } from './arbitration.service';
import { CreateFormationDto } from './dto/formation-create.dto';
import { JoinFormationDto } from './dto/formation-join.dto';
import { ComboDto } from './dto/combo.dto';
import { RescueDto } from './dto/rescue.dto';
import { ShameDto } from './dto/shame.dto';
import { GrudgeDto } from './dto/grudge.dto';
import { LootDto } from './dto/loot.dto';
import { ArbitrationDto } from './dto/arbitration.dto';
import { ArbitrationResolveDto } from './dto/arbitration-resolve.dto';
import { FaceAdjustDto } from './dto/face-adjust.dto';

@ApiTags('Combat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class CombatClientController {
  constructor(
    private readonly formationService: FormationService,
    private readonly rescueService: RescueService,
    private readonly faceService: FaceService,
    private readonly lootService: LootService,
    private readonly arbitrationService: ArbitrationService,
  ) {}

  private assertId(id: string): string {
    if (!/^\d+$/.test(id)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    return id;
  }

  // ===== 阵法 =====

  @Post('api/client/v1/combat/formations')
  @ApiOperation({ summary: '创建阵法' })
  async createFormation(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CreateFormationDto,
  ) {
    return this.formationService.createFormation(
      player.playerId,
      dto.formationId,
    );
  }

  @Post('api/client/v1/combat/formations/:id/join')
  @ApiOperation({ summary: '加入阵法' })
  async joinFormation(
    @Param('id') id: string,
    @Body() dto: JoinFormationDto,
  ) {
    return this.formationService.joinFormation(
      this.assertId(dto.playerId),
      this.assertId(id),
      dto.position,
    );
  }

  @Delete('api/client/v1/combat/formations/:id/leave')
  @ApiOperation({ summary: '离开阵法' })
  async leaveFormation(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.formationService.leaveFormation(player.playerId, this.assertId(id));
  }

  @Post('api/client/v1/combat/formations/:id/activate')
  @ApiOperation({ summary: '激活阵法' })
  async activateFormation(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') id: string,
  ) {
    return this.formationService.activateFormation(
      player.playerId,
      this.assertId(id),
    );
  }

  @Get('api/client/v1/combat/formations/:id')
  @ApiOperation({ summary: '阵法详情' })
  async getFormation(@Param('id') id: string) {
    return this.formationService.getFormation(this.assertId(id));
  }

  // ===== 合击 + 援护 =====

  @Post('api/client/v1/combat/combo')
  @ApiOperation({ summary: '合击' })
  async performCombo(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ComboDto,
  ) {
    return this.rescueService.performCombo(
      player.playerId,
      this.assertId(dto.partnerId),
      dto.combatLogId ? this.assertId(dto.combatLogId) : undefined,
    );
  }

  @Post('api/client/v1/combat/rescue')
  @ApiOperation({ summary: '援护' })
  async attemptRescue(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: RescueDto,
  ) {
    return this.rescueService.attemptRescue(
      player.playerId,
      this.assertId(dto.targetId),
    );
  }

  @Get('api/client/v1/combat/rescue/logs')
  @ApiOperation({ summary: '援护记录与今日次数' })
  async getRescueLogs(@CurrentPlayer() player: CurrentPlayerData) {
    const [logs, count] = await Promise.all([
      this.rescueService.getRescueLogs(player.playerId),
      this.rescueService.getRescueCount(player.playerId),
    ]);
    return { logs, ...count };
  }

  // ===== 颜面 =====

  @Post('api/client/v1/combat/face/adjust')
  @ApiOperation({ summary: '颜面调整（GM 占位）' })
  async adjustFace(@Body() dto: FaceAdjustDto) {
    return this.faceService.adjustFace(
      this.assertId(dto.playerId),
      dto.delta,
      dto.reason,
    );
  }

  @Post('api/client/v1/combat/shame')
  @ApiOperation({ summary: '公开羞辱' })
  async publicShame(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ShameDto,
  ) {
    return this.faceService.publicShame(
      player.playerId,
      this.assertId(dto.targetId),
    );
  }

  @Post('api/client/v1/combat/grudge/declare')
  @ApiOperation({ summary: '雪耻宣言' })
  async declareGrudge(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: GrudgeDto,
  ) {
    return this.faceService.declareGrudge(
      player.playerId,
      this.assertId(dto.targetId),
    );
  }

  // ===== 战利品 =====

  @Post('api/client/v1/combat/loot/distribute')
  @ApiOperation({ summary: '战利品分配' })
  async distributeLoot(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: LootDto,
  ) {
    return this.lootService.distributeLoot(
      player.playerId,
      this.assertId(dto.combatLogId),
      dto.mode,
      dto.itemsJson,
    );
  }

  @Get('api/client/v1/combat/loot/:combatLogId')
  @ApiOperation({ summary: '战利品分配记录' })
  async getLootLog(@Param('combatLogId') combatLogId: string) {
    return this.lootService.getLootLog(this.assertId(combatLogId));
  }

  // ===== 调解仲裁 =====

  @Post('api/client/v1/combat/arbitration')
  @ApiOperation({ summary: '发起仲裁' })
  async startArbitration(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ArbitrationDto,
  ) {
    return this.arbitrationService.startArbitration(
      player.playerId,
      this.assertId(dto.combatLogId),
      dto.partiesJson,
      dto.claimsJson,
    );
  }

  @Post('api/client/v1/combat/arbitration/:id/resolve')
  @ApiOperation({ summary: '仲裁结算' })
  async resolveArbitration(
    @Param('id') id: string,
    @Body() dto: ArbitrationResolveDto,
  ) {
    return this.arbitrationService.resolveArbitration(this.assertId(id), dto.result);
  }

  @Get('api/client/v1/combat/arbitration/:id')
  @ApiOperation({ summary: '仲裁详情' })
  async getArbitration(@Param('id') id: string) {
    return this.arbitrationService.getArbitration(this.assertId(id));
  }

  // ===== 战报 + Buff =====

  @Get('api/client/v1/combat/battle-report/:combatLogId')
  @ApiOperation({ summary: '战报' })
  async createBattleReport(@Param('combatLogId') combatLogId: string) {
    return this.faceService.createBattleReport(this.assertId(combatLogId));
  }

  @Get('api/client/v1/combat/buffs')
  @ApiOperation({ summary: '当前战斗 Buff 状态' })
  async getActiveBuffs(@CurrentPlayer() player: CurrentPlayerData) {
    return this.faceService.getActiveBuffs(player.playerId);
  }
}
