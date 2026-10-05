import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Guild } from './entities/guild.entity';
import { GuildMember } from './entities/guild-member.entity';
import { AdminGuard } from '@common/guards/admin.guard';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import { AdminService } from '@modules/admin/admin.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

@ApiTags('Admin-Social-Guild')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/social/guilds')
export class SocialGuildAdminController {
  constructor(
    @InjectRepository(Guild)
    private readonly guildRepo: Repository<Guild>,
    @InjectRepository(GuildMember)
    private readonly memberRepo: Repository<GuildMember>,
    private readonly adminService: AdminService,
  ) {}

  @Get()
  @ApiOperation({ summary: '公会列表（支持 name + 分页）' })
  async listGuilds(
    @Query('name') name?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const qb = this.guildRepo.createQueryBuilder('g');
    if (name) {
      qb.andWhere('g.name LIKE :name', { name: `%${name}%` });
    }
    qb.orderBy('g.createdAt', 'DESC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit));
    const [list, total] = await qb.getManyAndCount();
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Get(':id')
  @ApiOperation({ summary: '公会详情 + 成员概况' })
  async getGuild(@Param('id') id: string) {
    const guild = await this.guildRepo.findOne({ where: { id } });
    if (!guild) throw new GameException(ErrorCodes.PARAM_INVALID, 'Guild not found');
    const memberCount = await this.memberRepo.count({ where: { guildId: id } });
    return { guild, memberCount };
  }

  @Post(':id/notice')
  @ApiOperation({ summary: '更新公会公告（announcement）' })
  async updateNotice(
    @Param('id') id: string,
    @Body() body: { announcement?: string },
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const guild = await this.guildRepo.findOne({ where: { id } });
    if (!guild) throw new GameException(ErrorCodes.PARAM_INVALID, 'Guild not found');
    const before = { announcement: guild.announcement };
    guild.announcement = body.announcement ?? null;
    const saved = await this.guildRepo.save(guild);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'social.guild.notice',
      changeBefore: before,
      changeAfter: { announcement: saved.announcement },
    });
    return saved;
  }

  @Get(':id/members')
  @ApiOperation({ summary: '公会成员列表（分页）' })
  async listMembers(
    @Param('id') id: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const [list, total] = await this.memberRepo.findAndCount({
      where: { guildId: id },
      order: { joinedAt: 'DESC' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Post(':id/kick/:playerId')
  @ApiOperation({ summary: '管理员踢出成员' })
  async kickMember(
    @Param('id') guildId: string,
    @Param('playerId') playerId: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const guild = await this.guildRepo.findOne({ where: { id: guildId } });
    if (!guild) throw new GameException(ErrorCodes.PARAM_INVALID, 'Guild not found');
    const member = await this.memberRepo.findOne({
      where: { guildId, playerId },
    });
    if (!member) throw new GameException(ErrorCodes.PARAM_INVALID, 'GuildMember not found');
    await this.memberRepo.delete(member.id);
    // 同步 memberCount（Guild 没有自动触发器）
    const count = await this.memberRepo.count({ where: { guildId } });
    guild.memberCount = count;
    await this.guildRepo.save(guild);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'social.guild.kick',
      targetPlayerId: playerId,
      changeBefore: { guildId, role: member.role },
    });
    return { kicked: playerId, guildId };
  }
}
