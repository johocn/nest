import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CombatLog } from './entities/combat-log.entity';
import { Formation } from './entities/formation.entity';
import { CombatArbitration } from './entities/combat-arbitration.entity';
import { AdminGuard } from '@common/guards/admin.guard';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import { AdminService } from '@modules/admin/admin.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';
import { FaceService } from './face.service';
import { FaceAdjustDto } from './dto/face-adjust.dto';

@ApiTags('Admin-Combat')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/combat')
export class CombatAdminController {
  constructor(
    @InjectRepository(CombatLog)
    private readonly combatLogRepo: Repository<CombatLog>,
    @InjectRepository(Formation)
    private readonly formationRepo: Repository<Formation>,
    @InjectRepository(CombatArbitration)
    private readonly arbitrationRepo: Repository<CombatArbitration>,
    private readonly adminService: AdminService,
    private readonly faceService: FaceService,
  ) {}

  // ---------- CombatLog ----------

  @Get('logs')
  @ApiOperation({ summary: '战斗日志列表（支持 attackerId / defenderId / combatType / result + 分页）' })
  async listLogs(
    @Query('attackerId') attackerId?: string,
    @Query('defenderId') defenderId?: string,
    @Query('combatType') combatType?: string,
    @Query('result') result?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const where: any = {};
    if (attackerId) where.attackerId = attackerId;
    if (defenderId) where.defenderId = defenderId;
    if (combatType) where.combatType = combatType;
    if (result) where.result = result;

    const [list, total] = await this.combatLogRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Get('logs/:id')
  @ApiOperation({ summary: '战斗日志详情' })
  async getLog(@Param('id') id: string) {
    const log = await this.combatLogRepo.findOne({ where: { id } });
    if (!log) throw new GameException(ErrorCodes.PARAM_INVALID, 'CombatLog not found');
    return log;
  }

  @Delete('logs/:id')
  @ApiOperation({ summary: '删除战斗日志（硬删）' })
  async deleteLog(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const log = await this.combatLogRepo.findOne({ where: { id } });
    if (!log) throw new GameException(ErrorCodes.PARAM_INVALID, 'CombatLog not found');
    await this.combatLogRepo.delete(id);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'combat.log.delete',
      changeBefore: { id: log.id, attackerId: log.attackerId, defenderId: log.defenderId },
    });
    return { removed: id };
  }

  // ---------- Formation ----------

  @Get('formations')
  @ApiOperation({ summary: '阵容模板列表（支持 type + 分页）' })
  async listFormations(
    @Query('type') type?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const where: any = {};
    if (type) where.type = type;
    const [list, total] = await this.formationRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Post('formations')
  @ApiOperation({ summary: '新建阵容模板' })
  async createFormation(
    @Body() body: Partial<Formation>,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const created = this.formationRepo.create(body);
    const saved = await this.formationRepo.save(created);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'combat.formation.create',
      changeAfter: { id: saved.id, name: saved.name, type: saved.type },
    });
    return saved;
  }

  @Put('formations/:id')
  @ApiOperation({ summary: '更新阵容模板' })
  async updateFormation(
    @Param('id') id: string,
    @Body() body: Partial<Formation>,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const existing = await this.formationRepo.findOne({ where: { id } });
    if (!existing) throw new GameException(ErrorCodes.FORMATION_NOT_FOUND, 'Formation not found');
    const before = { ...existing };
    Object.assign(existing, body);
    const saved = await this.formationRepo.save(existing);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'combat.formation.update',
      changeBefore: before as any,
      changeAfter: saved as any,
    });
    return saved;
  }

  @Delete('formations/:id')
  @ApiOperation({ summary: '删除阵容模板（硬删）' })
  async deleteFormation(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const existing = await this.formationRepo.findOne({ where: { id } });
    if (!existing) throw new GameException(ErrorCodes.FORMATION_NOT_FOUND, 'Formation not found');
    await this.formationRepo.delete(id);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'combat.formation.delete',
      changeBefore: { id: existing.id, name: existing.name },
    });
    return { removed: id };
  }

  // ---------- CombatArbitration ----------

  @Get('arbitrations')
  @ApiOperation({ summary: '仲裁列表（支持 status + 分页）' })
  async listArbitrations(
    @Query('status') status?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    const where: any = {};
    if (status) where.status = status;
    const [list, total] = await this.arbitrationRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });
    return { list, total, page: Number(page), limit: Number(limit) };
  }

  @Get('arbitrations/:id')
  @ApiOperation({ summary: '仲裁详情' })
  async getArbitration(@Param('id') id: string) {
    const item = await this.arbitrationRepo.findOne({ where: { id } });
    if (!item) throw new GameException(ErrorCodes.PARAM_INVALID, 'CombatArbitration not found');
    return item;
  }

  @Post('arbitrations/:id/resolve')
  @ApiOperation({ summary: '手动介入仲裁（设置 status / result）' })
  async resolveArbitration(
    @Param('id') id: string,
    @Body() body: { status?: string; result?: string },
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const existing = await this.arbitrationRepo.findOne({ where: { id } });
    if (!existing) throw new GameException(ErrorCodes.PARAM_INVALID, 'CombatArbitration not found');
    const before = { status: existing.status, result: existing.result };
    if (body.status !== undefined) (existing as any).status = body.status;
    if (body.result !== undefined) existing.result = body.result;
    const saved = await this.arbitrationRepo.save(existing);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'combat.arbitration.resolve',
      changeBefore: before,
      changeAfter: { status: saved.status, result: saved.result },
    });
    return saved;
  }

  // ---------- Face ----------

  @Post('face/adjust')
  @ApiOperation({ summary: '颜面调整（GM）' })
  async adjustFace(
    @Body() dto: FaceAdjustDto,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    if (!/^\d+$/.test(dto.playerId)) {
      throw new GameException(ErrorCodes.PARAM_INVALID, '参数不合法');
    }
    const result = await this.faceService.adjustFace(dto.playerId, dto.delta, dto.reason);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'combat.face.adjust',
      changeAfter: { playerId: dto.playerId, delta: dto.delta, reason: dto.reason },
    });
    return result;
  }
}
