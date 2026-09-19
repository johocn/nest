import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CharacterService } from './character.service';
import { CreateCharacterDto } from './dto/create-character.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdateFactionDto } from './dto/update-faction.dto';
import { UpdateResourceDto } from './dto/update-resource.dto';
import { UpsertMartialArtDto } from './dto/upsert-martial-art.dto';
import { AddRelationshipDto } from './dto/add-relationship.dto';
import { UpdateCardDto, EquipTitleDto } from './dto/card.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@ApiTags('Character')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/character')
export class CharacterController {
  constructor(private readonly characterService: CharacterService) {}

  @Post('create')
  @ApiOperation({ summary: '创建角色' })
  async create(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CreateCharacterDto,
  ) {
    return this.characterService.createCharacter({
      playerId: player.playerId,
      name: dto.name,
      nickname: dto.nickname,
      profession: dto.profession,
      gender: dto.gender,
      age: dto.age,
      birthday: dto.birthday,
    });
  }

  @Get('profile')
  @ApiOperation({ summary: '获取角色完整档案' })
  async getProfile(@CurrentPlayer() player: CurrentPlayerData) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(
        ErrorCodes.PLAYER_NOT_FOUND,
        '角色不存在，请先创建角色',
      );
    }
    return this.characterService.getFullProfile(character.id);
  }

  @Put('attribute')
  @ApiOperation({ summary: '更新角色属性' })
  async updateAttribute(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: UpdateAttributeDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.updateAttribute(character.id, dto);
  }

  @Put('location')
  @ApiOperation({ summary: '更新角色位置' })
  async updateLocation(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: UpdateLocationDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.updateLocation(character.id, dto);
  }

  @Put('status')
  @ApiOperation({ summary: '更新角色状态' })
  async updateStatus(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: UpdateStatusDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.updateStatus(character.id, dto);
  }

  @Put('faction')
  @ApiOperation({ summary: '更新角色阵营' })
  async updateFaction(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: UpdateFactionDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.updateFaction(character.id, dto);
  }

  @Put('resource')
  @ApiOperation({ summary: '更新角色物资' })
  async updateResource(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: UpdateResourceDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.updateResource(character.id, dto);
  }

  @Put('martial-art')
  @ApiOperation({ summary: '更新/创建武学' })
  async upsertMartialArt(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: UpsertMartialArtDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.upsertMartialArt(
      character.id,
      dto.artType,
      dto.level,
      dto.skills,
    );
  }

  @Get('martial-arts')
  @ApiOperation({ summary: '获取武学列表' })
  async getMartialArts(@CurrentPlayer() player: CurrentPlayerData) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.getMartialArts(character.id);
  }

  @Post('relationship')
  @ApiOperation({ summary: '添加关系' })
  async addRelationship(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: AddRelationshipDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.addRelationship(
      character.id,
      dto.targetId,
      dto.favorability,
    );
  }

  @Get('relationships')
  @ApiOperation({ summary: '获取关系列表' })
  async getRelationships(@CurrentPlayer() player: CurrentPlayerData) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.getRelationships(character.id);
  }

  @Put('card')
  @ApiOperation({ summary: '设置名号/诗号' })
  async updateCard(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: UpdateCardDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.updateCard(character.id, dto);
  }

  @Post('titles/equip')
  @ApiOperation({ summary: '装备/卸下称号' })
  async equipTitle(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: EquipTitleDto,
  ) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.equipTitle(
      character.id,
      dto.titleId,
      dto.equip,
    );
  }

  @Get('titles')
  @ApiOperation({ summary: '我的称号列表' })
  async getTitles(@CurrentPlayer() player: CurrentPlayerData) {
    const character = await this.characterService.getByPlayerId(
      player.playerId,
    );
    if (!character) {
      throw new GameException(ErrorCodes.PLAYER_NOT_FOUND, '角色不存在');
    }
    return this.characterService.getTitles(character.id);
  }

  @Get('card/:id')
  @ApiOperation({ summary: '查看他人名片' })
  async getCard(@Param('id') characterId: string) {
    return this.characterService.getCard(characterId);
  }
}
