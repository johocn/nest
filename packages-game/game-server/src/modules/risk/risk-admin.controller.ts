import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RiskWashService } from './risk-wash.service';
import { RiskDisposeDto, RiskWhitelistDto, RiskRecoverDto, RiskRollbackDto, RiskRecoverProposalDto } from './dto/risk-admin.dto';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { RiskCaseStatus } from '@constants/enums';

@ApiTags('Admin-Risk')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/risk')
export class RiskAdminController {
  constructor(private readonly riskWashService: RiskWashService) {}

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
}