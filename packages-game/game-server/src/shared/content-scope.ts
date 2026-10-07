import {
  In,
  type FindOptionsWhere,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from 'typeorm';

/** 公共内容归属值：所有游戏可见 */
export const COMMON_SCOPE = 'common';

/** 主游戏默认 app 标识（apps 表 code；阶段 3 接入层解析前的缺省归属） */
export const DEFAULT_APP_CODE = 'main';

/**
 * 内容归属基类：scenes/scene_entity_spawns/scene_triggers/npc_templates/
 * npc_spawn_rules/dialogues/quest_templates 及 quiz 系列实体继承。
 * appCode 语义见 docs/superpowers/specs/2026-10-07-content-sharing-design.md 第 4 节。
 */
export abstract class ContentScopedEntity {
  appScope: string;
}

/** find/findOne 形态的 scope 条件（展开进 where 对象；any 使跨实体展开类型兼容） */
export function visibleTo(appCode: string | null): FindOptionsWhere<any> {
  return {
    appScope: In(appCode ? [COMMON_SCOPE, appCode] : [COMMON_SCOPE]),
  } as FindOptionsWhere<any>;
}

/** QueryBuilder 形态的 scope 条件 */
export function applyContentScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  appCode: string | null,
): SelectQueryBuilder<T> {
  return qb.andWhere(`${alias}.app_scope IN (:...scopes)`, {
    scopes: appCode ? [COMMON_SCOPE, appCode] : [COMMON_SCOPE],
  });
}
