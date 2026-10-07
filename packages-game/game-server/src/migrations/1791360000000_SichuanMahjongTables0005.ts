import { MigrationInterface, QueryRunner } from 'typeorm';

/** 四川麻将（血战到底）模块数据表：牌桌 + 对局结算记录 */
export class SichuanMahjongTables0005 implements MigrationInterface {
  name = 'SichuanMahjongTables0005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sichuanmajiang_rooms (
        id BIGSERIAL PRIMARY KEY,
        table_id VARCHAR(64) NOT NULL UNIQUE,
        mode VARCHAR(16) NOT NULL DEFAULT 'ai',
        host_player_id VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'waiting',
        players_json JSONB NOT NULL,
        settlement_json JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        started_at TIMESTAMP,
        finished_at TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sichuanmajiang_records (
        id BIGSERIAL PRIMARY KEY,
        table_id VARCHAR(64) NOT NULL,
        player_id VARCHAR(64) NOT NULL,
        seat INTEGER NOT NULL,
        score_delta BIGINT NOT NULL DEFAULT 0,
        fan_detail JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sichuanmajiang_records_table_id ON sichuanmajiang_records(table_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sichuanmajiang_records_player_id ON sichuanmajiang_records(player_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sichuanmajiang_records`);
    await queryRunner.query(`DROP TABLE IF EXISTS sichuanmajiang_rooms`);
  }
}
