import { MigrationInterface, QueryRunner } from 'typeorm';

/** 掼蛋模块数据表：牌桌 + 对局战绩（升级） */
export class GuandanTables0007 implements MigrationInterface {
  name = 'GuandanTables00071791450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS guandan_rooms (
        id BIGSERIAL PRIMARY KEY,
        table_id VARCHAR(64) NOT NULL UNIQUE,
        mode VARCHAR(16) NOT NULL DEFAULT 'ai',
        host_player_id VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'waiting',
        level_index INTEGER NOT NULL DEFAULT 0,
        players_json JSONB NOT NULL,
        settlement_json JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        started_at TIMESTAMP,
        finished_at TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS guandan_records (
        id BIGSERIAL PRIMARY KEY,
        table_id VARCHAR(64) NOT NULL,
        player_id VARCHAR(64) NOT NULL,
        seat INTEGER NOT NULL,
        team INTEGER NOT NULL DEFAULT 0,
        level_up INTEGER NOT NULL DEFAULT 0,
        is_winner BOOLEAN NOT NULL DEFAULT false,
        detail_json JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_guandan_records_table_id ON guandan_records(table_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_guandan_records_player_id ON guandan_records(player_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS guandan_records`);
    await queryRunner.query(`DROP TABLE IF EXISTS guandan_rooms`);
  }
}
