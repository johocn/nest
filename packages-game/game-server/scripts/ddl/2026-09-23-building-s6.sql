-- ============================================================================
-- S6 建造系统 DDL（生产库执行；禁在生产构建）
-- 来源：本地库由 TypeORM synchronize 建出的 5 张表，
--       经 `pg_dump --schema-only --no-owner --no-privileges -t <表>` 导出后
--       人工整理为**幂等**脚本（枚举 DO/EXCEPTION 包裹、表/序列/索引 IF NOT EXISTS、
--       PK 用 pg_constraint 存在性判断）。列/索引/PK 名与实体声明完全一致。
-- 目标库：1Panel-postgresql-4LsS / 用户 game / 库 game_server
-- 执行：docker exec -i 1Panel-postgresql-4LsS psql -U game -d game_server < 本文件
-- 幂等：可重复执行，不报错、不重复建对象。
-- ============================================================================

-- ---------- 1. 枚举类型（TypeORM 命名；顺序与本地库 pg_enum 一致）----------
DO $$ BEGIN
  CREATE TYPE public.building_instances_owner_type_enum AS ENUM ('player', 'guild');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.building_instances_state_enum AS ENUM ('building', 'built', 'demolishing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.scene_build_rules_mode_enum AS ENUM ('solo', 'coop', 'forbidden');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.scene_land_plots_state_enum AS ENUM ('empty', 'occupied', 'locked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- 2. 主键序列 ----------
CREATE SEQUENCE IF NOT EXISTS public.building_templates_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.scene_build_rules_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.scene_land_plots_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.building_instances_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.building_coop_contributions_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- ---------- 3. 建表 ----------
-- 建筑蓝图（配置数据）
CREATE TABLE IF NOT EXISTS public.building_templates (
    id bigint NOT NULL,
    name character varying(64) NOT NULL,
    res_key character varying(128) NOT NULL,
    category character varying(32) NOT NULL,
    footprint_w integer DEFAULT 1 NOT NULL,
    footprint_h integer DEFAULT 1 NOT NULL,
    build_cost jsonb DEFAULT '[]'::jsonb NOT NULL,
    build_seconds integer DEFAULT 60 NOT NULL,
    durability integer DEFAULT 100 NOT NULL,
    effect jsonb DEFAULT '{}'::jsonb NOT NULL,
    unlock_condition jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);

-- 场景建造规则（每场景至多一行；无行 = 该场景 forbidden）
CREATE TABLE IF NOT EXISTS public.scene_build_rules (
    id bigint NOT NULL,
    scene_id bigint NOT NULL,
    mode public.scene_build_rules_mode_enum DEFAULT 'forbidden'::public.scene_build_rules_mode_enum NOT NULL,
    land_grid_size integer DEFAULT 64 NOT NULL,
    max_buildings_per_player integer DEFAULT 5 NOT NULL,
    allow_demolish boolean DEFAULT true NOT NULL,
    coop_min_contributors integer DEFAULT 2 NOT NULL,
    coop_expire_hours integer DEFAULT 24 NOT NULL,
    reserved_zones jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);

-- 场景地块（惰性创建；唯一索引 (scene_id,gx,gy) 承担并发互斥）
CREATE TABLE IF NOT EXISTS public.scene_land_plots (
    id bigint NOT NULL,
    scene_id bigint NOT NULL,
    gx integer NOT NULL,
    gy integer NOT NULL,
    w integer DEFAULT 1 NOT NULL,
    h integer DEFAULT 1 NOT NULL,
    state public.scene_land_plots_state_enum DEFAULT 'empty'::public.scene_land_plots_state_enum NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);

-- 建筑实例（building/built/demolishing 三态一表）
CREATE TABLE IF NOT EXISTS public.building_instances (
    id bigint NOT NULL,
    scene_id bigint NOT NULL,
    plot_id bigint NOT NULL,
    template_id bigint NOT NULL,
    owner_type public.building_instances_owner_type_enum NOT NULL,
    owner_id bigint NOT NULL,
    state public.building_instances_state_enum DEFAULT 'building'::public.building_instances_state_enum NOT NULL,
    finish_at timestamp with time zone,
    durability integer NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);

-- 共建投料流水（超时退款按流水逐条原路返还，refunded 标记保证幂等）
CREATE TABLE IF NOT EXISTS public.building_coop_contributions (
    id bigint NOT NULL,
    building_instance_id bigint NOT NULL,
    player_id bigint NOT NULL,
    item_id bigint,
    currency_type character varying(32),
    amount integer NOT NULL,
    refunded boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);

-- ---------- 4. 序列归属 + 主键默认值 ----------
ALTER SEQUENCE public.building_templates_id_seq OWNED BY public.building_templates.id;
ALTER SEQUENCE public.scene_build_rules_id_seq OWNED BY public.scene_build_rules.id;
ALTER SEQUENCE public.scene_land_plots_id_seq OWNED BY public.scene_land_plots.id;
ALTER SEQUENCE public.building_instances_id_seq OWNED BY public.building_instances.id;
ALTER SEQUENCE public.building_coop_contributions_id_seq OWNED BY public.building_coop_contributions.id;

ALTER TABLE ONLY public.building_templates ALTER COLUMN id SET DEFAULT nextval('public.building_templates_id_seq'::regclass);
ALTER TABLE ONLY public.scene_build_rules ALTER COLUMN id SET DEFAULT nextval('public.scene_build_rules_id_seq'::regclass);
ALTER TABLE ONLY public.scene_land_plots ALTER COLUMN id SET DEFAULT nextval('public.scene_land_plots_id_seq'::regclass);
ALTER TABLE ONLY public.building_instances ALTER COLUMN id SET DEFAULT nextval('public.building_instances_id_seq'::regclass);
ALTER TABLE ONLY public.building_coop_contributions ALTER COLUMN id SET DEFAULT nextval('public.building_coop_contributions_id_seq'::regclass);

-- ---------- 5. 主键约束（按 conname 判存在，幂等）----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PK_495d083896f3fcb5681b66e9ec6') THEN
    ALTER TABLE ONLY public.building_templates ADD CONSTRAINT "PK_495d083896f3fcb5681b66e9ec6" PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PK_c53ddcd092e28aaaa031f26c41d') THEN
    ALTER TABLE ONLY public.scene_build_rules ADD CONSTRAINT "PK_c53ddcd092e28aaaa031f26c41d" PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PK_4e72d3e32b4a8f61f36c674c3ea') THEN
    ALTER TABLE ONLY public.scene_land_plots ADD CONSTRAINT "PK_4e72d3e32b4a8f61f36c674c3ea" PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PK_ef7f001e647d74cc80be452cd2a') THEN
    ALTER TABLE ONLY public.building_instances ADD CONSTRAINT "PK_ef7f001e647d74cc80be452cd2a" PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PK_1c78d037015ce330df9d483194a') THEN
    ALTER TABLE ONLY public.building_coop_contributions ADD CONSTRAINT "PK_1c78d037015ce330df9d483194a" PRIMARY KEY (id);
  END IF;
END $$;

-- ---------- 6. 索引（含唯一索引）----------
CREATE UNIQUE INDEX IF NOT EXISTS uq_plot_scene_grid ON public.scene_land_plots USING btree (scene_id, gx, gy);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scene_build_rule_scene ON public.scene_build_rules USING btree (scene_id);
CREATE INDEX IF NOT EXISTS idx_building_instance_scene_state ON public.building_instances USING btree (scene_id, state);
CREATE INDEX IF NOT EXISTS idx_coop_contribution_building ON public.building_coop_contributions USING btree (building_instance_id);