import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AchievementService } from './achievement.service';
import { AdminGuard } from '@common/guards/admin.guard';

/**
 * admin-web ↔ entity 字段映射层
 *
 * admin-web 字段: name / category / type / target / condition / reward / isActive
 * entity 字段:     name / category / type / isActive / targetValue / condition(enum) /
 *                  conditionJson(jsonb) / rewardJson(jsonb) / description
 *
 * condition 兼容：enum string 存 condition；JSON 对象存 conditionJson
 */

const isJsonObject = (v: any): boolean =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const toEntityPayload = (dto: any): any => {
  const out: any = { ...dto };

  // target → targetValue
  if (dto.target !== undefined) {
    out.targetValue = dto.target;
    delete out.target;
  }

  // reward → rewardJson
  if (dto.reward !== undefined) {
    out.rewardJson = isJsonObject(dto.reward) ? dto.reward : { value: dto.reward };
    delete out.reward;
  }

  // condition: enum string → condition; JSON 对象 → conditionJson
  if (dto.condition !== undefined) {
    if (isJsonObject(dto.condition)) {
      out.conditionJson = dto.condition;
    } else {
      out.condition = dto.condition;
    }
    delete out.condition;
  }

  return out;
};

const fromEntity = (e: any): any => {
  if (!e) return e;
  return {
    ...e,
    // targetValue → target
    target: e.targetValue,
    // rewardJson → reward
    reward: e.rewardJson,
    // conditionJson 有值时作为 condition 的前端回退
    condition: e.conditionJson && Object.keys(e.conditionJson).length > 0
      ? e.conditionJson
      : e.condition,
  };
};

/** 成就模板管理（admin-web 路由前缀 api/admin/v1/achievement） */
@ApiTags('Admin-Achievement')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('api/admin/v1/achievement')
export class AchievementAdminController {
  constructor(private readonly achievementService: AchievementService) {}

  @Get('template/list')
  @ApiOperation({ summary: '成就模板列表（支持 category/isActive 筛选 + 分页）' })
  async listTemplates(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const result = await this.achievementService.listTemplates(
      Number(page),
      Number(limit),
    );
    return {
      ...result,
      items: result.items.map(fromEntity),
    };
  }

  @Post('template')
  @ApiOperation({ summary: '创建成就模板' })
  async createTemplate(@Body() body: any) {
    const entityPayload = toEntityPayload(body);
    const created = await this.achievementService.createTemplate(entityPayload);
    return fromEntity(created);
  }

  @Put('template/:id')
  @ApiOperation({ summary: '更新成就模板' })
  async updateTemplate(@Param('id') id: string, @Body() body: any) {
    const entityPayload = toEntityPayload(body);
    const updated = await this.achievementService.updateTemplate(id, entityPayload);
    return fromEntity(updated);
  }
}
