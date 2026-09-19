import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SocialService } from './social.service';
import { ApplyFriendDto } from './dto/apply-friend.dto';
import {
  CreateGuildDto,
  JoinGuildDto,
  DonateDto,
} from './dto/create-guild.dto';
import { IntelSpyDto } from './dto/intel-spy.dto';
import { IntelInquireDto } from './dto/intel-inquire.dto';
import { IntelListDto } from './dto/intel-list.dto';
import { IntelBuyDto } from './dto/intel-buy.dto';
import { GiftDto } from './dto/gift.dto';
import { KinshipFormDto } from './dto/kinship-form.dto';
import { KinshipBreakDto } from './dto/kinship-break.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentPlayer } from '@common/decorators/current-player.decorator';
import type { CurrentPlayerData } from '@common/decorators/current-player.decorator';
import { DonateType } from '@constants/enums';

@ApiTags('Social')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/client/v1/social')
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  // ===== Friends =====

  @Post('friend/apply')
  @ApiOperation({ summary: '好友申请' })
  async applyFriend(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: ApplyFriendDto,
  ) {
    return this.socialService.applyFriend(player.playerId, dto.friendId);
  }

  @Post('friend/accept/:friendId')
  @ApiOperation({ summary: '接受好友申请' })
  async acceptFriend(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('friendId') friendId: string,
  ) {
    return this.socialService.acceptFriend(player.playerId, friendId);
  }

  @Get('friend/list')
  @ApiOperation({ summary: '好友列表' })
  async getFriendList(@CurrentPlayer() player: CurrentPlayerData) {
    return this.socialService.getFriendList(player.playerId);
  }

  @Delete('friend/:friendId')
  @ApiOperation({ summary: '删除好友' })
  async removeFriend(
    @CurrentPlayer() player: CurrentPlayerData,
    @Param('friendId') friendId: string,
  ) {
    await this.socialService.removeFriend(player.playerId, friendId);
    return { success: true };
  }

  // ===== Guild =====

  @Post('guild/create')
  @ApiOperation({ summary: '创建公会' })
  async createGuild(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: CreateGuildDto,
  ) {
    return this.socialService.createGuild(player.playerId, dto.name);
  }

  @Post('guild/join')
  @ApiOperation({ summary: '加入公会' })
  async joinGuild(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: JoinGuildDto,
  ) {
    return this.socialService.joinGuild(player.playerId, dto.guildId);
  }

  @Get('guild/:guildId')
  @ApiOperation({ summary: '公会信息' })
  async getGuildInfo(@Param('guildId') guildId: string) {
    return this.socialService.getGuildInfo(guildId);
  }

  @Get('guild/:guildId/members')
  @ApiOperation({ summary: '公会成员列表' })
  async getGuildMembers(@Param('guildId') guildId: string) {
    return this.socialService.getGuildMembers(guildId);
  }

  @Post('guild/donate')
  @ApiOperation({ summary: '公会捐献' })
  async donate(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: DonateDto,
  ) {
    return this.socialService.donateToGuild(
      player.playerId,
      dto.guildId,
      dto.donateType as DonateType,
      dto.amount,
    );
  }

  // ===== Intelligence =====

  @Post('intel/spy')
  @ApiOperation({ summary: '刺探情报' })
  async spyIntel(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: IntelSpyDto,
  ) {
    return this.socialService.spyIntelligence(player.playerId, dto.targetId);
  }

  @Post('intel/inquire')
  @ApiOperation({ summary: '打听情报' })
  async inquireIntel(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: IntelInquireDto,
  ) {
    return this.socialService.inquireIntelligence(player.playerId, dto.topic);
  }

  @Post('intel/eavesdrop')
  @ApiOperation({ summary: '窃听情报' })
  async eavesdropIntel(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: IntelSpyDto,
  ) {
    return this.socialService.eavesdropIntelligence(
      player.playerId,
      dto.targetId,
    );
  }

  @Get('intel/mine')
  @ApiOperation({ summary: '我的情报' })
  async myIntel(@CurrentPlayer() player: CurrentPlayerData) {
    return this.socialService.getIntelligences(player.playerId);
  }

  @Post('intel/list')
  @ApiOperation({ summary: '挂单出售情报' })
  async listIntel(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: IntelListDto,
  ) {
    return this.socialService.listIntelligence(
      player.playerId,
      dto.intelId,
      dto.price,
    );
  }

  @Get('intel/market')
  @ApiOperation({ summary: '情报市场' })
  async intelMarket(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.socialService.getIntelMarket(page, limit);
  }

  @Post('intel/buy')
  @ApiOperation({ summary: '购买情报' })
  async buyIntel(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: IntelBuyDto,
  ) {
    return this.socialService.buyIntelligence(player.playerId, dto.intelId);
  }

  // ===== Gifts =====

  @Post('gift/send')
  @ApiOperation({ summary: '送礼' })
  async sendGift(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: GiftDto,
  ) {
    return this.socialService.sendGift(
      player.playerId,
      dto.targetId,
      dto.itemId,
    );
  }

  @Post('gift/reciprocate')
  @ApiOperation({ summary: '回礼' })
  async reciprocateGift(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: GiftDto,
  ) {
    return this.socialService.reciprocateGift(
      player.playerId,
      dto.targetId,
      dto.itemId,
    );
  }

  // ===== Kinship =====

  @Post('kinship/form')
  @ApiOperation({ summary: '缔结亲缘（结义/师徒/侠侣）' })
  async formKinship(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: KinshipFormDto,
  ) {
    return this.socialService.formKinship(
      player.playerId,
      dto.type,
      dto.memberIds,
      dto.name,
    );
  }

  @Post('kinship/break')
  @ApiOperation({ summary: '解除亲缘' })
  async breakKinship(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: KinshipBreakDto,
  ) {
    return this.socialService.breakKinship(player.playerId, dto.kinshipId);
  }

  @Post('kinship/graduate')
  @ApiOperation({ summary: '师徒出师' })
  async graduateApprentice(
    @CurrentPlayer() player: CurrentPlayerData,
    @Body() dto: KinshipBreakDto,
  ) {
    return this.socialService.graduateApprentice(
      player.playerId,
      dto.kinshipId,
    );
  }

  @Get('kinships')
  @ApiOperation({ summary: '我的亲缘列表' })
  async getKinships(@CurrentPlayer() player: CurrentPlayerData) {
    return this.socialService.getKinships(player.playerId);
  }

  @Get('relationships')
  @ApiOperation({ summary: '关系总览（好友+亲缘+好感）' })
  async getRelationships(@CurrentPlayer() player: CurrentPlayerData) {
    return this.socialService.getSocialSummary(player.playerId);
  }
}
