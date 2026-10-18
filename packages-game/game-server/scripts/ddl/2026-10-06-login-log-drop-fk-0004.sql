-- ============================================================================
-- Migration 0004 等价 SQL：account_login_logs.account_id 移除外键
-- 来源：src/migrations/1791271000000_LoginLogDropForeignKey0004.ts（两处保持同步）
-- 原因：登录失败且账号不存在时 auth.service 记录哨兵 account_id='0'，
--       FK 约束使该插入抛 QueryFailedError → 全局过滤器兜底 90004，
--       吞掉真实的「账号不存在」业务码（10001）。
-- 背景：该表由早期 TypeORM synchronize 建表产生 FK，约束名为 hash
--       （本机实测 FK_753551fcca12d313aa37e646951，各环境不同），
--       故按 表+列 动态查询后 drop。
-- 执行：docker exec -i 1Panel-postgresql-4LsS psql -U game -d game_server < 本文件
-- 幂等：可重复执行，FK 不存在时为 no-op。
-- 验证：SELECT conname FROM pg_constraint
--       WHERE conrelid = 'account_login_logs'::regclass AND contype = 'f';
--       期望返回 0 行。
-- ============================================================================

-- ---------- up：动态 drop account_login_logs.account_id 上的外键 ----------
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT rc.constraint_name INTO constraint_name
  FROM information_schema.referential_constraints rc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = rc.constraint_name
   AND kcu.table_schema = rc.constraint_schema
  WHERE rc.constraint_schema = current_schema()
    AND rc.unique_constraint_schema = current_schema()
    AND kcu.table_name = 'account_login_logs'
    AND kcu.column_name = 'account_id'
  LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE account_login_logs DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- ---------- down：NOT VALID 重建（不校验存量哨兵 '0'，仅约束后续写入）----------
-- 回滚时取消下面注释执行；VALIDATE CONSTRAINT 由运维在清理 '0' 存量后按需执行：
-- DO $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM information_schema.referential_constraints rc
--     JOIN information_schema.key_column_usage kcu
--       ON kcu.constraint_name = rc.constraint_name
--      AND kcu.table_schema = rc.constraint_schema
--     WHERE rc.constraint_schema = current_schema()
--       AND kcu.table_name = 'account_login_logs'
--       AND kcu.column_name = 'account_id'
--   ) THEN
--     EXECUTE 'ALTER TABLE account_login_logs ADD CONSTRAINT fk_account_login_logs_account
--       FOREIGN KEY (account_id) REFERENCES auth_accounts(id) NOT VALID';
--   END IF;
-- END $$;
