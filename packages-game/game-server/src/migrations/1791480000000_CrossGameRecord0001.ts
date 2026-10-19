import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 跨游戏关卡评分记录表（与 scoring 模块解耦）。
 * 唯一键 (player_id, target_game_id, level_id)：同一关只保留最佳成绩。
 */
export class CrossGameRecord00011791480000000 implements MigrationInterface {
  name = 'CrossGameRecord00011791480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
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
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS cross_game_records`);
  }
}
