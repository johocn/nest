-- 评分系统缺失表补建（HEAD 代码在 onApplicationBootstrap 读取 scoring_configs，缺表会导致 app.init 失败）
-- 对应迁移：1791470000000_ScoringTables0009 / 1791475000000_ScoringConfigJson0010 / 1791480000000_CrossGameRecord0001

CREATE TABLE IF NOT EXISTS player_scoring_states (
  id BIGSERIAL PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  game_id VARCHAR(64) NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_player_scoring UNIQUE (player_id, game_id)
);

CREATE TABLE IF NOT EXISTS scoring_configs (
  id BIGSERIAL PRIMARY KEY,
  game_id VARCHAR(64) NOT NULL,
  config JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_scoring_game UNIQUE (game_id)
);

CREATE TABLE IF NOT EXISTS cross_game_records (
  id BIGSERIAL PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  target_game_id VARCHAR(64) NOT NULL,
  level_id VARCHAR(32) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  score INT NOT NULL,
  axes JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cross_game UNIQUE (player_id, target_game_id, level_id)
);
