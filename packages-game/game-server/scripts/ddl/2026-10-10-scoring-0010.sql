-- scripts/ddl/2026-10-10-scoring-0010.sql
-- 评分配置列 jsonb → json（阶段 2 修复）：jsonb 不保键序，axes 声明顺序 round-trip 丢失。
-- 幂等：重复执行 ALTER TYPE json→json 无副作用（同类型转换是 no-op）。
\set ON_ERROR_STOP on

ALTER TABLE scoring_configs ALTER COLUMN config TYPE json USING config::text::json;

-- 验证：SELECT data_type FROM information_schema.columns
--       WHERE table_name='scoring_configs' AND column_name='config';  → json
-- 注意：存量行键序保持迁移时的存储序（jsonb 已重排）；需按声明序的话
--       用 admin PUT 重写一次（json 列此后保序）。
