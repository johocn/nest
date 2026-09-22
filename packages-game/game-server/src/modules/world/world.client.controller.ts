import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WorldService } from './world.service';
import { CharacterService } from '@modules/character/character.service';
import {
  ObjectInteractDto,
  TriggerActivateDto,
  MountActionDto,
  StartGameDto,
  BetGameDto,
  FinishGameDto,
  LandmarkMessageDto,
} from './dto/object-interact.dto';
import {
  ContributeDto,
  CreateBuildingRequestDto,
} from './dto/building.dto';
import { ChooseDialogueDto } from './dto/dialogue.dto';
import { DialogueService } from './dialogue/dialogue.service';
import { BuildRuleService } from './building/build-rule.service';
import { BuildingService } from './building/building.service';
import { BuildingAdminService } from './building/building-admin.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { BuildMode } from '@constants/enums';

@ApiTags('World')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/world')
export class WorldClientController {
  constructor(
    private readonly worldService: WorldService,
    private readonly characterService: CharacterService,
    private readonly dialogueService: DialogueService,
    private readonly buildRuleService: BuildRuleService,
    private readonly buildingService: BuildingService,
    private readonly buildingAdminService: BuildingAdminService,
  ) {}

  private async resolveCharacterId(playerId: string): Promise<string> {
    const character = await this.characterService.getByPlayerId(playerId);
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return character.id;
  }

  @Post('objects/:id/interact')
  @ApiOperation({ summary: '物件互动（采集/藏身/烧火/坐/躺/刻字等）' })
  async interactObject(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') objectId: string,
    @Body() dto: ObjectInteractDto,
  ) {
    return this.worldService.interactObject(
      player.playerId,
      objectId,
      dto.interactType,
    );
  }

  @Post('npcs/:spawnId/talk')
  @ApiOperation({ summary: 'NPC 对话（返回对话文案与可选项）' })
  async talkNpc(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('spawnId') spawnId: string,
  ) {
    return this.worldService.talkNpc(player.playerId, spawnId);
  }

  @Post('dialogue/choose')
  @ApiOperation({ summary: '对话选项推进（服务端权威：条件过滤 + 动作执行）' })
  async chooseDialogue(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ChooseDialogueDto,
  ) {
    return this.dialogueService.choose(player.playerId, dto);
  }

  @Post('triggers/:id/story')
  @ApiOperation({ summary: '剧情触发（story_id → 对话首节点，once_only 只触发一次）' })
  async triggerStory(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') triggerId: string,
  ) {
    return this.worldService.triggerStory(player.playerId, triggerId);
  }

  @Post('triggers/:id/activate')
  @ApiOperation({ summary: '机关配合解锁' })
  async activateTrigger(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') triggerId: string,
    @Body() dto: TriggerActivateDto,
  ) {
    return this.worldService.activateTrigger(
      player.playerId,
      triggerId,
      dto.memberIds ?? [],
    );
  }

  @Post('mounts/equip')
  @ApiOperation({ summary: '获得/切换坐骑' })
  async equipMount(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: MountActionDto,
  ) {
    const characterId = await this.resolveCharacterId(player.playerId);
    return this.worldService.equipMount(characterId, dto.mountId);
  }

  @Post('mounts/ride')
  @ApiOperation({ summary: '骑乘/收起坐骑' })
  async rideMount(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: MountActionDto,
  ) {
    const characterId = await this.resolveCharacterId(player.playerId);
    return this.worldService.rideMount(
      characterId,
      dto.mountId,
      dto.ride ?? true,
    );
  }

  @Post('games/start')
  @ApiOperation({ summary: '开局街头玩法（房主下注）' })
  async startGame(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: StartGameDto,
  ) {
    return this.worldService.startGame(player.playerId, dto.gameId, dto.betAmount);
  }

  @Post('games/bet')
  @ApiOperation({ summary: '围观下注' })
  async betGame(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: BetGameDto,
  ) {
    return this.worldService.betGame(player.playerId, dto.sessionId, dto.betAmount);
  }

  @Post('games/finish')
  @ApiOperation({ summary: '结算对局（房主，5% 场景税）' })
  async finishGame(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: FinishGameDto,
  ) {
    return this.worldService.finishGame(
      player.playerId,
      dto.sessionId,
      dto.winnerPlayerId,
    );
  }

  @Post('landmarks/:id/message')
  @ApiOperation({ summary: '路牌/地标留言' })
  async leaveLandmarkMessage(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') objectId: string,
    @Body() dto: LandmarkMessageDto,
  ) {
    return this.worldService.leaveLandmarkMessage(
      player.playerId,
      objectId,
      dto.content,
    );
  }

  @Get('landmarks/:id/messages')
  @ApiOperation({ summary: '地标留言列表（最近50条）' })
  async listLandmarkMessages(@Param('id') objectId: string) {
    return this.worldService.listLandmarkMessages(objectId);
  }

  @Get('scenes/:sceneId/build-rule')
  @ApiOperation({ summary: '场景建造规则（无规则行返回 forbidden 默认视图）' })
  async getBuildRule(@Param('sceneId') sceneId: string) {
    return this.buildRuleService.getRule(sceneId);
  }

  @Get('scenes/:sceneId/buildings')
  @ApiOperation({ summary: '场景建筑列表（可选 ownerId 过滤）' })
  async listBuildings(
    @Param('sceneId') sceneId: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.buildingService.listBuildings(
      sceneId,
      ownerId ? { ownerId } : undefined,
    );
  }

  @Get('building-templates')
  @ApiOperation({ summary: '建筑蓝图列表（仅启用中的蓝图，可选 category 过滤）' })
  async listBuildingTemplates(@Query('category') category?: string) {
    return this.buildingAdminService.listTemplates({
      isActive: true,
      ...(category ? { category } : {}),
    });
  }

  @Post('buildings')
  @ApiOperation({ summary: '建造建筑（按场景规则模式分派单独/共同建造）' })
  async createBuilding(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CreateBuildingRequestDto,
  ) {
    const rule = await this.buildRuleService.getRule(dto.sceneId);
    if (rule.mode === BuildMode.COOP) {
      return this.buildingService.createCoopBuilding(
        player.playerId,
        dto.sceneId,
        dto,
      );
    }
    // SOLO / FORBIDDEN 均走单独建造入口，由 assertCanBuild 抛 BUILD_FORBIDDEN
    return this.buildingService.createBuilding(player.playerId, dto.sceneId, dto);
  }

  @Post('buildings/:id/contribute')
  @ApiOperation({ summary: '共建投料（达标即改写落成时刻）' })
  async contributeToBuilding(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') buildingId: string,
    @Body() dto: ContributeDto,
  ) {
    return this.buildingService.contribute(player.playerId, buildingId, dto.items);
  }

  @Post('buildings/:id/demolish')
  @ApiOperation({ summary: '拆除建筑（仅所有者，不退款）' })
  async demolishBuilding(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('id') buildingId: string,
  ) {
    return this.buildingService.demolish(player.playerId, buildingId);
  }
}
