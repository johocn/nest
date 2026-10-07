import {
  In,
  type FindOptionsWhere,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from 'typeorm';

/** 公共内容归属值：所有游戏可见 */
export const COMMON_SCOPE = 'common';

/**
 * 内容归属基类：scenes/scene_entity_spawns/scene_triggers/npc_templates/
 * npc_spawn_rules/dialogues/quest_templates 及 quiz 系列实体继承。
 * appCode 语义见 docs/superpowers/specs/2026-10-07-content-sharing-design.md 第 4 节。
 */
export abstract class ContentScopedEntity {
  appScope: string;
}

/** find/findOne 形态的 scope 条件（展开进 where 对象） */
export function visibleTo(appCode: string | null): FindOptionsWhere<never> {
  return {
    appScope: In(appCode ? [COMMON_SCOPE, appCode] : [COMMON_SCOPE]),
  } as FindOptionsWhere<never>;
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
