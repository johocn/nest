import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * account_login_logs.account_id 移除外键：
 * 登录失败且账号不存在时 auth.service 记录哨兵值 '0'，FK 约束会让该插入抛
 * QueryFailedError → 全局过滤器兜底成 90004，吞掉真实的「账号不存在」业务码。
 * （该表由早期 synchronize 建表产生 FK，约束名为 hash，动态查询后 drop）
 */
export class LoginLogDropForeignKey0004 implements MigrationInterface {
  name = 'LoginLogDropForeignKey00041791271000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
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
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // NOT VALID：不校验存量哨兵 '0'，仅约束后续写入；VALIDATE 由运维按需执行
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.referential_constraints rc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = rc.constraint_name
           AND kcu.table_schema = rc.constraint_schema
          WHERE rc.constraint_schema = current_schema()
            AND kcu.table_name = 'account_login_logs'
            AND kcu.column_name = 'account_id'
        ) THEN
          EXECUTE 'ALTER TABLE account_login_logs ADD CONSTRAINT fk_account_login_logs_account
            FOREIGN KEY (account_id) REFERENCES auth_accounts(id) NOT VALID';
        END IF;
      END $$;
    `);
  }
}
