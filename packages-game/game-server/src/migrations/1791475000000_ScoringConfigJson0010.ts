import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 评分配置列 jsonb → json（阶段 2 修复）。
 * jsonb 不保键序（按长度/字节排序存储），round-trip 后 axes 声明顺序丢失，
 * 违反「score 视图按 config 声明顺序下发」契约；配置是整存整取的文档，
 * 不用 jsonb 的索引/包含查询能力，改用保序的 json。
 */
export class ScoringConfigJson0010 implements MigrationInterface {
  name = 'ScoringConfigJson00101791475000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE scoring_configs ALTER COLUMN config TYPE json USING config::text::json`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE scoring_configs ALTER COLUMN config TYPE jsonb USING config::text::jsonb`,
    );
  }
}
