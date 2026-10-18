import { MigrationInterface, QueryRunner } from 'typeorm';

/** 评分系统（阶段 2）数据表：玩家评分状态 + 评分配置（含内置示例 seeds） */
export class ScoringTables0009 implements MigrationInterface {
  name = 'ScoringTables00091791470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS player_scoring_states (
        id BIGSERIAL PRIMARY KEY,
        player_id VARCHAR(64) NOT NULL,
        game_id VARCHAR(64) NOT NULL,
        state JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_player_scoring UNIQUE (player_id, game_id)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scoring_configs (
        id BIGSERIAL PRIMARY KEY,
        game_id VARCHAR(64) NOT NULL,
        config JSON NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await queryRunner.query(
      `ALTER TABLE scoring_configs ADD CONSTRAINT uq_scoring_game UNIQUE (game_id)`,
    );
    await queryRunner.query(`
      INSERT INTO scoring_configs (game_id, config, is_active) VALUES
        ('history-teach', '{"gameId":"history-teach","enabled":["axis","affinity","flag"],"axes":{"wisdom":{"label":"智慧","min":0,"max":300,"visible":true,"initial":0},"wealth":{"label":"财富","min":0,"max":99999,"visible":true,"initial":100}},"npcs":["孔子","巴菲特","范蠡","诸葛亮","达芬奇","马斯克"],"branches":[{"id":"sage-route","when":[{"kind":"affinity","id":"孔子","op":">=","value":50}],"goto":"confucius_route"},{"id":"rich-end","when":[{"kind":"axis","id":"wealth","op":">=","value":500}],"goto":"rich_end"},{"id":"wise-end","when":[{"kind":"axis","id":"wisdom","op":">=","value":100}],"goto":"wise_end"}]}', true),
        ('demo-rpg', '{"gameId":"demo-rpg","enabled":["dual","faction"],"axes":{"paragon":{"label":"楷模","min":-100,"max":100,"visible":true,"initial":0},"renegade":{"label":"叛逆","min":-100,"max":100,"visible":true,"initial":0}},"factions":["联邦","叛军"],"branches":[{"id":"hero-end","when":[{"kind":"axis","id":"paragon","op":">=","value":60}],"goto":"hero_end"},{"id":"villain-end","when":[{"kind":"axis","id":"renegade","op":">=","value":60}],"goto":"villain_end"},{"id":"fed-route","when":[{"kind":"reputation","id":"联邦","op":">=","value":20}],"goto":"fed_route"}]}', true)
      ON CONFLICT (game_id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE scoring_configs DROP CONSTRAINT IF EXISTS uq_scoring_game`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS scoring_configs`);
    await queryRunner.query(`DROP TABLE IF EXISTS player_scoring_states`);
  }
}
