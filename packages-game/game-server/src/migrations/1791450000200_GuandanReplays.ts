import { MigrationInterface, QueryRunner } from 'typeorm';

/** 掼蛋回合回放表：支撑复盘（开局手牌 + 动作日志） */
export class GuandanReplays implements MigrationInterface {
  name = 'GuandanReplays1791450000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS guandan_replays (
        id BIGSERIAL PRIMARY KEY,
        table_id VARCHAR(64) NOT NULL,
        level INTEGER NOT NULL DEFAULT 0,
        players_json JSONB NOT NULL,
        initial_hands_json JSONB NOT NULL,
        actions_json JSONB NOT NULL,
        settlement_json JSONB,
        kowtow_json JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_guandan_replays_table_id ON guandan_replays(table_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS guandan_replays`);
  }
}
