-- S1: scene_triggers 增加场景归属列（生产由人工在维护窗口执行，禁止服务器构建）
BEGIN;

ALTER TABLE scene_triggers
  ADD COLUMN IF NOT EXISTS scene_id bigint;

CREATE INDEX IF NOT EXISTS idx_trigger_scene
  ON scene_triggers (scene_id);

-- 存量数据归属：按触发器矩形中心点落在哪个场景的地图范围内回填（无匹配则保持 NULL）
UPDATE scene_triggers t
SET scene_id = s.id
FROM scenes s
WHERE t.scene_id IS NULL
  AND t.area_x >= 0 AND t.area_y >= 0
  AND t.area_x <= s.map_width AND t.area_y <= s.map_height
  AND (SELECT count(*) FROM scenes) = 1;

COMMIT;