import { MigrationInterface, QueryRunner } from 'typeorm';

/** quiz 题库模块（阶段 2）数据表：题目池 + 结果库 + 测评卷 + 卷条目 + 会话 + 答题流水 */
export class QuizTables0006 implements MigrationInterface {
  name = 'QuizTables0006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
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
      )
    `);
    await queryRunner.query(`
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
      )
    `);
    await queryRunner.query(`
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
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS quiz_assessment_items (
        id BIGSERIAL PRIMARY KEY,
        assessment_id BIGINT NOT NULL,
        question_id BIGINT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        next_question_id BIGINT,
        dimension VARCHAR(32),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
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
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS quiz_answers (
        id BIGSERIAL PRIMARY KEY,
        player_id VARCHAR(64) NOT NULL,
        question_id BIGINT NOT NULL,
        is_correct BOOLEAN NOT NULL,
        app_code VARCHAR(32) NOT NULL DEFAULT 'main',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_question_code ON quiz_questions (app_scope, code)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_result_code ON quiz_results (app_scope, code)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_assessment_code ON quiz_assessments (app_scope, code)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_quiz_items_assessment ON quiz_assessment_items (assessment_id, sort_order)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_quiz_sessions_player ON quiz_sessions (player_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_quiz_answers_player_question ON quiz_answers (player_id, question_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_quiz_answers_player_question`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_quiz_sessions_player`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_quiz_items_assessment`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_quiz_assessment_code`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_quiz_result_code`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_quiz_question_code`);
    await queryRunner.query(`DROP TABLE IF EXISTS quiz_answers`);
    await queryRunner.query(`DROP TABLE IF EXISTS quiz_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS quiz_assessment_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS quiz_assessments`);
    await queryRunner.query(`DROP TABLE IF EXISTS quiz_results`);
    await queryRunner.query(`DROP TABLE IF EXISTS quiz_questions`);
  }
}
