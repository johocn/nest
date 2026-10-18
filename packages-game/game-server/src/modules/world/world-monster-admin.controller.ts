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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WorldService } from './world.service';
import { MonsterTemplate } from './entities/monster-template.entity';
import { AdminGuard } from '@common/guards/admin.guard';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import type { AdminJwtPayload } from '@common/guards/admin.guard';
import { AdminService } from '@modules/admin/admin.service';
import { GameException } from '@common/exceptions/game.exception';
import { ErrorCodes } from '@constants/error-codes';

interface MonsterQueryDto {
  name?: string;
  aiType?: string;
  page?: number;
  limit?: number;
}

@ApiTags('Admin-World')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/world/monsters')
export class WorldMonsterAdminController {
  constructor(
    private readonly worldService: WorldService,
    private readonly adminService: AdminService,
  ) {}

  @Get()
  @ApiOperation({ summary: '怪物模板列表（支持 name / aiType 过滤 + 分页）' })
  async listMonsters(@Query() query: MonsterQueryDto) {
    return this.worldService.getMonsterTemplates({
      name: query.name,
      aiType: query.aiType,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '怪物模板详情' })
  async getMonster(@Param('id') id: string) {
    const monster = await this.worldService.getMonsterTemplate(id);
    if (!monster) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `MonsterTemplate ${id} 不存在`,
      );
    }
    return monster;
  }

  @Post()
  @ApiOperation({ summary: '新建怪物模板' })
  async createMonster(
    @Body() dto: Partial<MonsterTemplate>,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const monster = await this.worldService.createMonsterTemplate(dto);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'monster.create',
      changeBefore: {},
      changeAfter: {
        id: monster.id,
        name: monster.name,
        aiType: monster.aiType,
        baseHp: monster.baseHp,
        baseAtk: monster.baseAtk,
      },
    });
    return monster;
  }

  @Put(':id')
  @ApiOperation({ summary: '更新怪物模板' })
  async updateMonster(
    @Param('id') id: string,
    @Body() dto: Partial<MonsterTemplate>,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const before = await this.worldService.getMonsterTemplate(id);
    if (!before) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `MonsterTemplate ${id} 不存在`,
      );
    }
    const saved = await this.worldService.updateMonsterTemplate(id, dto);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'monster.update',
      changeBefore: {
        name: before.name,
        aiType: before.aiType,
        baseHp: before.baseHp,
        baseAtk: before.baseAtk,
        aggroRange: before.aggroRange,
        refreshCd: before.refreshCd,
      },
      changeAfter: {
        name: saved.name,
        aiType: saved.aiType,
        baseHp: saved.baseHp,
        baseAtk: saved.baseAtk,
        aggroRange: saved.aggroRange,
        refreshCd: saved.refreshCd,
      },
    });
    return saved;
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除怪物模板（软删）' })
  async deleteMonster(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminJwtPayload,
  ) {
    const before = await this.worldService.getMonsterTemplate(id);
    if (!before) {
      throw new GameException(
        ErrorCodes.PARAM_INVALID,
        `MonsterTemplate ${id} 不存在`,
      );
    }
    await this.worldService.deleteMonsterTemplate(id);
    await this.adminService.logOperation({
      adminId: admin.adminId,
      operation: 'monster.delete',
      changeBefore: {
        id: before.id,
        name: before.name,
        aiType: before.aiType,
      },
      changeAfter: { deleted: true },
    });
    return { success: true };
  }
}
