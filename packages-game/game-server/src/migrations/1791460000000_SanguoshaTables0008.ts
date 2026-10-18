import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 三国杀模块数据表：牌桌 + 对局战绩（含运营商级隔离 tenant_id 列）。
 * 与 guandan_rooms / sichuanmajiang 物理分表，互不影响。
 */
export class SanguoshaTables0008 implements MigrationInterface {
  name = 'SanguoshaTables00081791460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sanguosha_rooms (
        id BIGSERIAL PRIMARY KEY,
        table_id VARCHAR(64) NOT NULL UNIQUE,
        tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
        mode VARCHAR(16) NOT NULL DEFAULT 'ai',
        host_player_id VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'waiting',
        players_json JSONB NOT NULL,
        sockets_json JSONB,
        state_json JSONB NOT NULL,
        events_json JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        started_at TIMESTAMP,
        finished_at TIMESTAMP
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sanguosha_rooms_tenant_id ON sanguosha_rooms(tenant_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sanguosha_records (
        id BIGSERIAL PRIMARY KEY,
        table_id VARCHAR(64) NOT NULL,
        tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
        player_id VARCHAR(64) NOT NULL,
        seat INTEGER NOT NULL,
        identity VARCHAR(16),
        is_winner BOOLEAN NOT NULL DEFAULT false,
        detail_json JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sanguosha_records_table_id ON sanguosha_records(table_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sanguosha_records_tenant_id ON sanguosha_records(tenant_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_sanguosha_records_player_id ON sanguosha_records(player_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sanguosha_records`);
    await queryRunner.query(`DROP TABLE IF EXISTS sanguosha_rooms`);
  }
}
