-- scripts/ddl/2026-10-07-quiz-0006.sql
-- quiz 题库模块（阶段 2）：题目池 + 结果库 + 测评卷 + 卷条目 + 会话 + 答题流水
-- 幂等：可重复执行。执行后验证见文件尾注释。
\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS quiz_questions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  multi_select BOOLEAN NOT NULL DEFAULT false,
  category VARCHAR(64),
  difficulty INTEGER NOT NULL DEFAULT 1,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  reward_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  app_scope VARCHAR(32) NOT NULL DEFAULT 'common',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  content TEXT NOT NULL,
  reward_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  app_scope VARCHAR(32) NOT NULL DEFAULT 'common',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quiz_assessments (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  description TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  scoring_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  start_question_id BIGINT,
  app_scope VARCHAR(32) NOT NULL DEFAULT 'common',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quiz_assessment_items (
  id BIGSERIAL PRIMARY KEY,
  assessment_id BIGINT NOT NULL,
  question_id BIGINT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  next_question_id BIGINT,
  dimension VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id BIGSERIAL PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  assessment_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'in_progress',
  current_question_id BIGINT,
  total_score INTEGER NOT NULL DEFAULT 0,
  dim_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  app_code VARCHAR(32) NOT NULL DEFAULT 'main',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id BIGSERIAL PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  question_id BIGINT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  app_code VARCHAR(32) NOT NULL DEFAULT 'main',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_question_code ON quiz_questions (app_scope, code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_result_code ON quiz_results (app_scope, code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_assessment_code ON quiz_assessments (app_scope, code);
CREATE INDEX IF NOT EXISTS idx_quiz_items_assessment ON quiz_assessment_items (assessment_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_player ON quiz_sessions (player_id, status);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_player_question ON quiz_answers (player_id, question_id);

COMMIT;

-- 验证：SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'quiz_%' ORDER BY 1;  → 6 张表
-- 验证：\d quiz_questions（含唯一索引 uq_quiz_question_code (app_scope, code)）
