-- ============================================================================
-- S6 建造系统生产种子（幂等；可重复执行）
-- 目标库：1Panel-postgresql-4LsS / 用户 game / 库 game_server
-- 执行：docker exec -i 1Panel-postgresql-4LsS psql -U game -d game_server < 本文件
--
-- 生产场景事实（执行前已核实）：scenes 仅有 id=1「新手村（Spike）」。
--   1) solo 规则 → 已存在的首个场景（id=1）；
--   2) coop 规则 → **本文件新建的专用共建场景「共建广场」**（生产无合适既有场景）；
--   3) 3 个建筑蓝图（木屋/石墙/议事厅，其中「议事厅」build_cost 为空数组，供线上零门槛验收建一栋）。
-- 判重：rules 走唯一索引 uq_scene_build_rule_scene（ON CONFLICT (scene_id) DO NOTHING）；
--       scenes / building_templates 无唯一键，走 WHERE NOT EXISTS 按 name 判重。
-- ============================================================================

-- ---------- 1. solo 场景规则（首个既有场景）----------
INSERT INTO public.scene_build_rules
  (scene_id, mode, land_grid_size, max_buildings_per_player, allow_demolish, coop_min_contributors, coop_expire_hours, reserved_zones, created_at, updated_at)
SELECT s.id, 'solo', 64, 5, true, 2, 24, '[]'::jsonb, now(), now()
FROM (SELECT id FROM public.scenes ORDER BY id ASC LIMIT 1) s
ON CONFLICT (scene_id) DO NOTHING;

-- ---------- 2. 共建专用场景（不存在则新建）----------
INSERT INTO public.scenes
  (name, scene_type, map_res_key, map_width, map_height, layer_config, trigger_group_ids, min_level, max_players, status, created_at, updated_at)
SELECT '共建广场', 'town', 'map/coop_plaza', 1280, 960, '{}'::jsonb, '{}', 1, 100, 'open', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.scenes WHERE name = '共建广场');

-- ---------- 3. 共建场景规则（coop / 2 人 / 24h）----------
INSERT INTO public.scene_build_rules
  (scene_id, mode, land_grid_size, max_buildings_per_player, allow_demolish, coop_min_contributors, coop_expire_hours, reserved_zones, created_at, updated_at)
SELECT s.id, 'coop', 64, 5, true, 2, 24, '[]'::jsonb, now(), now()
FROM public.scenes s
WHERE s.name = '共建广场'
ON CONFLICT (scene_id) DO NOTHING;

-- ---------- 4. 建筑蓝图（按 name 判重）----------
INSERT INTO public.building_templates
  (name, res_key, category, footprint_w, footprint_h, build_cost, build_seconds, durability, effect, unlock_condition, is_active, created_at, updated_at)
SELECT '木屋', 'building/wooden_house', 'house', 2, 2, '[{"currencyType":"gold","amount":50}]'::jsonb, 15, 300, '{}'::jsonb, NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.building_templates WHERE name = '木屋');

INSERT INTO public.building_templates
  (name, res_key, category, footprint_w, footprint_h, build_cost, build_seconds, durability, effect, unlock_condition, is_active, created_at, updated_at)
SELECT '石墙', 'building/stone_wall', 'defense', 1, 1, '[{"currencyType":"gold","amount":20}]'::jsonb, 10, 500, '{}'::jsonb, NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.building_templates WHERE name = '石墙');

-- 议事厅：build_cost 为空数组（零门槛，线上验收建一栋用），耗时 5s
INSERT INTO public.building_templates
  (name, res_key, category, footprint_w, footprint_h, build_cost, build_seconds, durability, effect, unlock_condition, is_active, created_at, updated_at)
SELECT '议事厅', 'building/town_hall', 'public', 3, 3, '[]'::jsonb, 5, 800, '{}'::jsonb, NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.building_templates WHERE name = '议事厅');

-- ---------- 5. 结果核对 ----------
SELECT 'rules' AS kind, scene_id::text AS k1, mode::text AS k2 FROM public.scene_build_rules
UNION ALL
SELECT 'templates', name, build_cost::text FROM public.building_templates ORDER BY 1, 2;