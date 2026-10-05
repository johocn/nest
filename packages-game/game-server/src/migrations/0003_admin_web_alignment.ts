import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminWebAlignment0003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // AchievementTemplate: type + is_active + condition_json
    await queryRunner.query(`ALTER TABLE achievement_templates ADD COLUMN IF NOT EXISTS "type" varchar(64)`);
    await queryRunner.query(`ALTER TABLE achievement_templates ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE achievement_templates ADD COLUMN IF NOT EXISTS "condition_json" jsonb NOT NULL DEFAULT '{}'`);

    // ActivityTemplate: priority + is_active + rules_json
    await queryRunner.query(`ALTER TABLE activity_templates ADD COLUMN IF NOT EXISTS "priority" int NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE activity_templates ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE activity_templates ADD COLUMN IF NOT EXISTS "rules_json" jsonb NOT NULL DEFAULT '{}'`);

    // VipConfig: name + multiplier + is_active
    await queryRunner.query(`ALTER TABLE vip_configs ADD COLUMN IF NOT EXISTS "name" varchar(64)`);
    await queryRunner.query(`ALTER TABLE vip_configs ADD COLUMN IF NOT EXISTS "multiplier" double precision NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE vip_configs ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true`);

    // Notice: scope + priority (is_active already existed from initial schema)
    await queryRunner.query(`ALTER TABLE notices ADD COLUMN IF NOT EXISTS "scope" varchar(32) NOT NULL DEFAULT 'global'`);
    await queryRunner.query(`ALTER TABLE notices ADD COLUMN IF NOT EXISTS "priority" varchar(16) NOT NULL DEFAULT 'normal'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE achievement_templates DROP COLUMN IF EXISTS "type"`);
    await queryRunner.query(`ALTER TABLE achievement_templates DROP COLUMN IF EXISTS "is_active"`);
    await queryRunner.query(`ALTER TABLE achievement_templates DROP COLUMN IF EXISTS "condition_json"`);
    await queryRunner.query(`ALTER TABLE activity_templates DROP COLUMN IF EXISTS "priority"`);
    await queryRunner.query(`ALTER TABLE activity_templates DROP COLUMN IF EXISTS "is_active"`);
    await queryRunner.query(`ALTER TABLE activity_templates DROP COLUMN IF EXISTS "rules_json"`);
    await queryRunner.query(`ALTER TABLE vip_configs DROP COLUMN IF EXISTS "name"`);
    await queryRunner.query(`ALTER TABLE vip_configs DROP COLUMN IF EXISTS "multiplier"`);
    await queryRunner.query(`ALTER TABLE vip_configs DROP COLUMN IF EXISTS "is_active"`);
    await queryRunner.query(`ALTER TABLE notices DROP COLUMN IF EXISTS "scope"`);
    await queryRunner.query(`ALTER TABLE notices DROP COLUMN IF EXISTS "priority"`);
  }
}
