-- scripts/ddl/2026-10-09-scoring-0009.sql
-- 对话分支评分系统（阶段 2）：玩家评分状态 + 评分配置
-- 幂等：可重复执行（uq_scoring_game 的 ALTER ADD CONSTRAINT 除外，重复执行会因约束已存在报错）。验证见文件尾注释。
\set ON_ERROR_STOP on

BEGIN;

-- 玩家评分状态（key = player_id + game_id）
CREATE TABLE IF NOT EXISTS player_scoring_states (
  id BIGSERIAL PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  game_id VARCHAR(64) NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_player_scoring UNIQUE (player_id, game_id)
);

-- 评分配置（每游戏一份 ScoringConfig；config 用 json 保键序——jsonb 会按长度/字节重排键，
-- round-trip 后 axes 声明顺序丢失，违反 score 视图「按 config 声明顺序下发」契约）
CREATE TABLE IF NOT EXISTS scoring_configs (
  id BIGSERIAL PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  config JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE scoring_configs ADD CONSTRAINT uq_scoring_game UNIQUE (game_id);

-- 内置示例配置 seeds（与 src/modules/scoring/config/*.ts 逐字一致）
INSERT INTO scoring_configs (game_id, config, is_active) VALUES
  ('history-teach', '{"gameId":"history-teach","enabled":["axis","affinity","flag"],"axes":{"wisdom":{"label":"智慧","min":0,"max":300,"visible":true,"initial":0},"wealth":{"label":"财富","min":0,"max":99999,"visible":true,"initial":100}},"npcs":["孔子","巴菲特","范蠡","诸葛亮","达芬奇","马斯克"],"branches":[{"id":"sage-route","when":[{"kind":"affinity","id":"孔子","op":">=","value":50}],"goto":"confucius_route"},{"id":"rich-end","when":[{"kind":"axis","id":"wealth","op":">=","value":500}],"goto":"rich_end"},{"id":"wise-end","when":[{"kind":"axis","id":"wisdom","op":">=","value":100}],"goto":"wise_end"}]}', true),
  ('demo-rpg', '{"gameId":"demo-rpg","enabled":["dual","faction"],"axes":{"paragon":{"label":"楷模","min":-100,"max":100,"visible":true,"initial":0},"renegade":{"label":"叛逆","min":-100,"max":100,"visible":true,"initial":0}},"factions":["联邦","叛军"],"branches":[{"id":"hero-end","when":[{"kind":"axis","id":"paragon","op":">=","value":60}],"goto":"hero_end"},{"id":"villain-end","when":[{"kind":"axis","id":"renegade","op":">=","value":60}],"goto":"villain_end"},{"id":"fed-route","when":[{"kind":"reputation","id":"联邦","op":">=","value":20}],"goto":"fed_route"}]}', true)
ON CONFLICT (game_id) DO NOTHING;

COMMIT;

-- 验证：SELECT game_id FROM scoring_configs ORDER BY 1;  → history-teach / demo-rpg 两行
-- 验证：\d player_scoring_states（含约束 uq_player_scoring UNIQUE (player_id, game_id)）
-- 验证：\d scoring_configs（含约束 uq_scoring_game UNIQUE (game_id)）
