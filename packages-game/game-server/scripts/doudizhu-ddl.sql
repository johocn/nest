-- 斗地主模块建表（生产 DB_SYNCHRONIZE=false，需手动执行一次）
-- 对应实体：doudizhu_rooms / doudizhu_records / doudizhu_replays

DO $$ BEGIN
  CREATE TYPE doudizhu_rooms_mode_enum AS ENUM ('ai', 'net');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doudizhu_rooms_status_enum AS ENUM ('waiting', 'playing', 'finished');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS doudizhu_rooms (
  id bigserial PRIMARY KEY,
  table_id varchar(64) NOT NULL,
  mode doudizhu_rooms_mode_enum NOT NULL DEFAULT 'ai',
  host_player_id varchar(64) NOT NULL,
  status doudizhu_rooms_status_enum NOT NULL DEFAULT 'waiting',
  landlord_seat integer NULL,
  base_score integer NOT NULL DEFAULT 1,
  multiplier integer NOT NULL DEFAULT 1,
  winner_seat integer NULL,
  landlord_win boolean NULL,
  scores_json jsonb NULL,
  players_json jsonb NOT NULL,
  settlement_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamp NULL,
  finished_at timestamp NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_doudizhu_rooms_table_id ON doudizhu_rooms(table_id);

CREATE TABLE IF NOT EXISTS doudizhu_records (
  id bigserial PRIMARY KEY,
  table_id varchar(64) NOT NULL,
  player_id varchar(64) NOT NULL,
  seat integer NOT NULL,
  is_landlord boolean NOT NULL DEFAULT false,
  is_winner boolean NOT NULL DEFAULT false,
  delta_score integer NOT NULL DEFAULT 0,
  detail_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doudizhu_records_table ON doudizhu_records(table_id);
CREATE INDEX IF NOT EXISTS idx_doudizhu_records_player ON doudizhu_records(player_id);

CREATE TABLE IF NOT EXISTS doudizhu_replays (
  id bigserial PRIMARY KEY,
  table_id varchar(64) NOT NULL,
  players_json jsonb NOT NULL,
  initial_hands_json jsonb NOT NULL,
  actions_json jsonb NOT NULL,
  settlement_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doudizhu_replays_table ON doudizhu_replays(table_id);
