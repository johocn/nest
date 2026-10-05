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
import { AchievementCondition } from '@constants/enums';

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

/**
 * 从 condition JSON 对象的 key 推断 AchievementCondition enum 值。
 * key 来源：admin-web condition textarea 常见写法
 *   {"kills": 100}     → KILL_COUNT
 *   {"winCount": 50}   → WIN_COMBAT
 *   {"questCount": 3}  → COMPLETE_QUEST
 *   {"currencyEarned": 10000} → EARN_CURRENCY
 *   {"guildId": 1}     → JOIN_GUILD
 *   {"friendCount": 5} → ADD_FRIEND
 *   {"target": 60}     → REACH_LEVEL
 */
const JSON_KEY_TO_ENUM: Record<string, AchievementCondition> = {
  kills: AchievementCondition.KILL_COUNT,
  killCount: AchievementCondition.KILL_COUNT,
  target: AchievementCondition.REACH_LEVEL,
  level: AchievementCondition.REACH_LEVEL,
  questId: AchievementCondition.COMPLETE_QUEST,
  questCount: AchievementCondition.COMPLETE_QUEST,
  quests: AchievementCondition.COMPLETE_QUEST,
  totalGold: AchievementCondition.EARN_CURRENCY,
  currencyEarned: AchievementCondition.EARN_CURRENCY,
  earn: AchievementCondition.EARN_CURRENCY,
  guildId: AchievementCondition.JOIN_GUILD,
  joinGuild: AchievementCondition.JOIN_GUILD,
  friendCount: AchievementCondition.ADD_FRIEND,
  friends: AchievementCondition.ADD_FRIEND,
  wins: AchievementCondition.WIN_COMBAT,
  winCount: AchievementCondition.WIN_COMBAT,
  winCombat: AchievementCondition.WIN_COMBAT,
};

/** 给 JSON 对象的 keys 推断出最匹配的 AchievementCondition enum 值 */
function inferConditionFromJson(json: Record<string, any>): AchievementCondition | null {
  for (const key of Object.keys(json)) {
    if (JSON_KEY_TO_ENUM[key]) return JSON_KEY_TO_ENUM[key];
  }
  return null;
}

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

  // condition: enum string → condition; JSON 对象 → conditionJson + 推断 enum
  if (dto.condition !== undefined) {
    if (isJsonObject(dto.condition)) {
      out.conditionJson = dto.condition;
      // 从 JSON keys 推断 enum 值（让 advanceByCondition 能正确匹配）
      const inferred = inferConditionFromJson(dto.condition);
      out.condition = inferred ?? AchievementCondition.REACH_LEVEL;
    } else {
      out.condition = dto.condition;
    }
    delete out.condition;
  } else {
    // admin-web 完全不传 condition 时，保证 enum 列有值
    if (!out.condition) out.condition = AchievementCondition.REACH_LEVEL;
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
