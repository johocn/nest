import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Delete,
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
}
