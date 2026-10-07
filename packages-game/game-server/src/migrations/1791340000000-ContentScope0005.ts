import { MigrationInterface, QueryRunner } from 'typeorm';

const CONTENT_TABLES = [
  'scenes',
  'scene_entity_spawns',
  'scene_triggers',
  'npc_templates',
  'npc_spawn_rules',
  'quest_templates',
];

export class ContentScope00051791340000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    for (const t of CONTENT_TABLES) {
      await qr.query(
        `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common'`,
      );
    }
    await qr.query(`ALTER TABLE dialogues ADD COLUMN IF NOT EXISTS app_scope varchar(32) NOT NULL DEFAULT 'common'`);
    // dialogue 唯一索引改复合（现存 uq_dialogue_code 是唯一索引而非约束，已查 pg_indexes 确认）
    await qr.query(`DROP INDEX IF EXISTS uq_dialogue_code`);
    await qr.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_dialogue_code ON dialogues (app_scope, code)`);
    await qr.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id bigserial PRIMARY KEY,
        code varchar(32) NOT NULL UNIQUE,
        name varchar(64) NOT NULL,
        api_key varchar(128) NOT NULL DEFAULT '',
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS apps`);
    await qr.query(`DROP INDEX IF EXISTS uq_dialogue_code`);
    await qr.query(`CREATE UNIQUE INDEX uq_dialogue_code ON dialogues (code)`);
    await qr.query(`ALTER TABLE dialogues DROP COLUMN IF EXISTS app_scope`);
    for (const t of CONTENT_TABLES) {
      await qr.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS app_scope`);
    }
  }
}
