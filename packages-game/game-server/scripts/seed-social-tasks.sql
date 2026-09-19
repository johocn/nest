-- ============================================================================
-- E4 社交/生态任务种子数据（quest_templates 补充）
-- 依据：docs/superpowers/specs/2026-09-20-social-task-supplement-design.md §6
-- 列名与 quest-template.entity.ts 完全一致：
--   name / quest_type / min_level / accept_limit / auto_reward /
--   target_json / reward_json / prerequisite_ids /
--   target_type / prerequisite_social / reward_social / repeatable
-- 说明：
--   1. target 数量无独立列，落在 target_json.count（quest.service.ts 解析
--      targetJson?.count ?? targetJson?.kill_count ?? 1）
--   2. reward_social 结构为 { currencyType, amount }（submitQuest 按
--      currencyType + amount 解析，currencyType ∈ favor/guild_contrib/face）
--   3. quest_type 枚举无 social 类，社交/生态任务归 daily；'daily' 以
--      SELECT 常量输出（VALUES 中字符串字面量会被推断为 text，无法隐式
--      赋给 enum 列）
--   4. name 无唯一索引，幂等采用 INSERT ... SELECT ... WHERE NOT EXISTS(name)
-- 幂等：重复执行不产生重复行
-- ============================================================================

INSERT INTO quest_templates
  (name, quest_type, min_level, accept_limit, auto_reward,
   target_json, reward_json, prerequisite_ids,
   target_type, prerequisite_social, reward_social, repeatable,
   created_at, updated_at)
SELECT v.name, 'daily', v.min_level, v.accept_limit, v.auto_reward,
       v.target_json, v.reward_json, v.prerequisite_ids,
       v.target_type, v.prerequisite_social, v.reward_social, v.repeatable,
       now(), now()
FROM (VALUES
  -- ===== 生态 P0 =====
  ('初窥门径·浏览文章',   1, 1, false, '{"count":3}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'view_article',      NULL::jsonb, '{"currencyType":"favor","amount":10}'::jsonb, false),
  ('江湖见闻·查看课程',   1, 1, false, '{"count":2}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'view_course',       NULL::jsonb, '{"currencyType":"favor","amount":10}'::jsonb, false),
  ('货比三家·查看商品',   1, 1, false, '{"count":3}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'view_product',      NULL::jsonb, '{"currencyType":"face","amount":5}'::jsonb,  false),
  ('一探究竟·查看价格',   1, 1, false, '{"count":2}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'view_price',        NULL::jsonb, '{"currencyType":"face","amount":5}'::jsonb,  false),
  ('闻讯而动·报名活动',   1, 1, false, '{"count":1}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'join_activity',     NULL::jsonb, '{"currencyType":"face","amount":10}'::jsonb, false),
  -- ===== 生态 P1 =====
  ('英雄所见·点赞文章',   1, 1, false, '{"count":3}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'like',              NULL::jsonb, '{"currencyType":"favor","amount":15}'::jsonb, false),
  ('仗义执言·发表评论',   1, 1, false, '{"count":1}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'comment',           NULL::jsonb, '{"currencyType":"favor","amount":15}'::jsonb, false),
  ('千金一诺·完成成交',   1, 1, false, '{"count":1}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'purchase',          NULL::jsonb, '{"currencyType":"face","amount":20}'::jsonb,  false),
  -- ===== 游戏内补充（战斗/经济） =====
  ('结阵而战·激活阵法',   1, 1, false, '{"count":1}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'activate_formation', NULL::jsonb, '{"currencyType":"guild_contrib","amount":20}'::jsonb, false),
  ('同生共死·成功援护',   1, 1, false, '{"count":1}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'rescue_success',     NULL::jsonb, '{"currencyType":"favor","amount":15}'::jsonb, false),
  ('一诺千金·担保放款',   1, 1, false, '{"count":1}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'escrow_released',    NULL::jsonb, '{"currencyType":"guild_contrib","amount":20}'::jsonb, false),
  ('广而告之·发布悬赏',   1, 1, false, '{"count":1}'::jsonb,                        '{}'::jsonb,        '{}'::int[], 'bounty_published',   NULL::jsonb, '{"currencyType":"face","amount":10}'::jsonb, false)
) AS v(name, min_level, accept_limit, auto_reward,
       target_json, reward_json, prerequisite_ids,
       target_type, prerequisite_social, reward_social, repeatable)
WHERE NOT EXISTS (
  SELECT 1 FROM quest_templates t WHERE t.name = v.name
);

-- 验证（重复执行后应恒为 12）
SELECT count(*) AS social_seed_count
FROM quest_templates
WHERE name IN (
  '初窥门径·浏览文章', '江湖见闻·查看课程', '货比三家·查看商品', '一探究竟·查看价格',
  '闻讯而动·报名活动', '英雄所见·点赞文章', '仗义执言·发表评论', '千金一诺·完成成交',
  '结阵而战·激活阵法', '同生共死·成功援护', '一诺千金·担保放款', '广而告之·发布悬赏'
);
