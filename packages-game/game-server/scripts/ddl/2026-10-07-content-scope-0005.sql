-- scripts/ddl/2026-10-07-content-scope-0005.sql
-- 内容共享 scope 基础设施（阶段 1）：内容表 app_scope + dialogues 复合唯一 + apps 表
-- 幂等：可重复执行。执行后验证见文件尾注释。
\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE scenes            ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE scene_entity_spawns ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE scene_triggers    ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE npc_templates     ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE npc_spawn_rules   ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE quest_templates   ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';
ALTER TABLE dialogues         ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common';

-- 现存 uq_dialogue_code 为唯一索引（非约束），必须用 DROP INDEX
DROP INDEX IF EXISTS uq_dialogue_code;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dialogue_code ON dialogues (app_scope, code);

CREATE TABLE IF NOT EXISTS apps (
  id bigserial PRIMARY KEY,
  code varchar(32) NOT NULL UNIQUE,
  name varchar(64) NOT NULL,
  api_key varchar(128) NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

INSERT INTO apps (code, name) VALUES ('main', '主游戏') ON CONFLICT (code) DO NOTHING;

COMMIT;

-- 验证：SELECT app_scope, count(*) FROM scenes GROUP BY 1;  → 仅 common
-- 验证：SELECT code FROM apps;                              → main
