import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RiskWashService } from './risk-wash.service';
import { RiskReplayService } from './risk-replay.service';
import { RiskIdentityService } from './risk-identity.service';
import { RiskDisposeDto, RiskWhitelistDto, RiskRecoverDto, RiskRollbackDto, RiskRecoverProposalDto, RiskLockDto, RiskReplayDto } from './dto/risk-admin.dto';
import { assertValidThresholdOverrides } from './risk-detect';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { AdminService } from '@modules/admin/admin.service';
import { RiskCaseStatus } from '@constants/enums';

@ApiTags('Admin-Risk')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/risk')
export class RiskAdminController {
  constructor(
    private readonly riskWashService: RiskWashService,
    private readonly riskReplayService: RiskReplayService,
    private readonly adminService: AdminService,
    private readonly riskIdentityService: RiskIdentityService,
  ) {}

  @Get('cases')
  @ApiOperation({ summary: '风控线索列表' })
  async listCases(@Query('status') status?: string, @Query('type') type?: string) {
    const st = status as RiskCaseStatus | undefined;
    return { list: await this.riskWashService.listCases(st, type) };
  }

  @Get('players/:playerId')
  @ApiOperation({ summary: '账号风险分+未处置线索' })
  async playerScore(@Param('playerId') playerId: string) {
    const [score, cases] = await Promise.all([
      this.riskWashService.getAccountScore(playerId),
      this.riskWashService.listOpenCasesByPlayer(playerId),
    ]);
    return { score, cases };
  }

  @Get('identity/player/:playerId')
  @ApiOperation({ summary: '身份聚类图谱：一人多号关联（只读）' })
  async identityGraph(@Param('playerId') playerId: string) {
    return this.riskIdentityService.graphOf(playerId);
  }

  @Post('cases/:id/dispose')
  @ApiOperation({ summary: '处置风控线索（frozen/ignored）' })
  async dispose(
    @Param('id') id: string,
    @Body() dto: RiskDisposeDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    return { case: await this.riskWashService.disposeCase(id, dto.action, admin.username, dto.note) };
  }

  @Post('whitelist')
  @ApiOperation({ summary: '加白名单（误报豁免）' })
  async addWhitelist(@Body() dto: RiskWhitelistDto, @CurrentAdmin() admin: AdminJwtPayload) {
    return { whitelist: await this.riskWashService.addWhitelist(dto.playerId, dto.note, admin.username) };
  }

  @Delete('whitelist/:playerId')
  @ApiOperation({ summary: '移除白名单' })
  async removeWhitelist(@Param('playerId') playerId: string) {
    await this.riskWashService.removeWhitelist(playerId);
    return { success: true };
  }

  @Get('dashboard')
  @ApiOperation({ summary: '风控看板：高危TOP/待处置队列' })
  async dashboard() {
    return await this.riskWashService.dashboard();
  }

  @Post('cases/:id/recover-proposal')
  @ApiOperation({ summary: '计算污染建议回收额' })
  async recoverProposal(@Param('id') id: string) {
    return await this.riskWashService.recoverProposal(id);
  }

  @Post('cases/:id/recover')
  @ApiOperation({ summary: 'GM确认回收涉案超额（半自动）' })
  async recover(@Param('id') id: string, @Body() dto: RiskRecoverDto, @CurrentAdmin() admin: AdminJwtPayload) {
    return { record: await this.riskWashService.recover(id, admin.username, dto.note) };
  }

  @Post('recover/:rid/rollback')
  @ApiOperation({ summary: '回滚回收记录' })
  async rollback(@Param('rid') rid: string, @Body() dto: RiskRollbackDto, @CurrentAdmin() admin: AdminJwtPayload) {
    return { record: await this.riskWashService.rollback(rid, admin.username, dto.reason) };
  }

  @Post('cases/:id/lock')
  @ApiOperation({ summary: '高危线索封禁/交易封锁联动' })
  async lock(@Param('id') id: string, @Body() dto: RiskLockDto, @CurrentAdmin() admin: AdminJwtPayload) {
    return { result: await this.riskWashService.lock(id, admin.username, dto.level, dto.reason) };
  }

  @Post('replay')
  @ApiOperation({ summary: '阈值只读回放校准（不落库/不处置）' })
  async replay(@Body() dto: RiskReplayDto, @CurrentAdmin() admin: AdminJwtPayload) {
    // 只读：仅回放检测，不写任何业务表、不触发处置；非法 override 键直接 92901
    assertValidThresholdOverrides(dto.configOverrides);
    const result = await this.riskReplayService.replay({
      since: dto.since,
      until: dto.until,
      configOverrides: dto.configOverrides,
    });
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'risk.replay',
      changeBefore: { since: dto.since.toISOString(), until: dto.until.toISOString() },
      changeAfter: { iterated: result.iterated, hitCount: result.hitCount, scoreBuckets: result.scoreBuckets },
    });
    return result;
  }
}