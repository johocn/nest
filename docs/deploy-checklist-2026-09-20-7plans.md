# 部署准备清单 · 2026-09-20 连续 7 计划（P1–P7）上线

> 目标：把 P1–P7 的代码产物部署到 odoo（`39.106.99.9`，SSH 别名 `odoo`）game-server `/opt/game-server`，使其真正生效。
> 代码已全部推送 origin/main（基线 `a3d00adf2` → `d50c903a2`）。
> 全程遵循：**不登 2G 机构建**、库是 `1Panel-postgresql-4LsS`/`game_server`、进程由 systemd `game-server` 管理。
> ⚠️ 服务器时钟比本地慢 ~12 分钟（tar future timestamp 警告无害）。

---

## 0. 关键事实（部署前提）

- **生产 `DB_SYNCHRONIZE=true`** → 重启 game-server 时 TypeORM **自动建表 / 加列 / 加唯一索引**，通常**无需手动 DDL**。下方 DDL 作为「synchronize=false 的备用」或「核对差异」用。
- 部署 = 本地 `npm run build` → 打包 dist → 上传 odoo → 备份旧 dist → 替换 → `systemctl restart game-server` → journalctl 验启动 → 建种子/写配置 → 跑冒烟。
- 冒烟脚本 `scripts/smoke-stage5b.sh` 已含 P1–P7 各新段（本次新增未在线上跑过），部署后在服务器执行全量验证。

---

## 1. 部署主流程（一次性，P1–P7 共有）

本机（`E:\code\nest\packages-game\game-server`）：

```bash
# 1) 本地构建（不登 2G 机）
cd E:/code/nest/packages-game/game-server
npm run build

# 2) 打包 dist
cd E:/code/nest/packages-game/game-server
# 用绝对路径 -C 避免相对交叉（历史教训：0 字节包）
tar -czf dist-stage.tar.gz -C E:/code/nest/packages-game/game-server/dist .

# 3) 上传 odoo
scp dist-stage.tar.gz odoo:/tmp/

# 4) 服务器上：备份旧 + 替换 + 重启（PowerShell 用 base64 传复杂命令）
# 到 odoo：
#   cd /opt/game-server
#   cp -r dist dist_prev_$(date +%Y%m%d_%H%M%S)
#   rm -rf dist && mkdir dist && tar -xzf /tmp/dist-stage.tar.gz -C dist
#   systemctl restart game-server

# 5) 验启动
ssh odoo "journalctl -u game-server --since '-1 min'" | grep 'Nest application successfully started'

# 6) 验监听
ssh odoo "ss -ltnp | grep :3000"

# 7) Schema 自动同步核对（见 §2）
# 8) 写配置（见 §3）/ 种子（见 §4）
# 9) 冒烟（见 §5）
```

---

## 2. 自动同步的 Schema 变更清单（DB_SYNCHRONIZE=true 下重启即生效）

如某环境 accidents false，用下列 DDL 补齐（**同一事务内批量执行**）：

### P1 · `risk_recover_records` 加列
```sql
ALTER TABLE risk_recover_records ADD COLUMN IF NOT EXISTS economy_ref_id varchar(64) NULL;
```

### P3 · `risk_identity_links` 建表
```sql
CREATE TABLE IF NOT EXISTS risk_identity_links (
  id bigserial PRIMARY KEY,
  player_id_a varchar(64) NOT NULL,
  player_id_b varchar(64) NOT NULL,
  link_type text NOT NULL,              -- enum RiskLinkType: SAME_IP / SAME_DEVICE / SSO
  confidence double precision DEFAULT 0,
  evidence_json jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
-- 唯一：a<b 字典序去重（服务端已保证，仍建议索引）
CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_identity_links ON risk_identity_links(player_id_a, player_id_b, link_type);
```

### P5 · `reconcile_results` 建表
```sql
CREATE TABLE IF NOT EXISTS reconcile_results (
  id bigserial PRIMARY KEY,
  stat_date varchar(10) NOT NULL,
  reconcile_type text NOT NULL,         -- enum ReconcileType: TRADE / AUCTION / ESCROW / BOUNTY
  checked bigint DEFAULT 0,
  mismatch bigint DEFAULT 0,
  detail_json jsonb DEFAULT '[]',       -- [{ bizId, type: MISSING_FLOW|AMOUNT_MISMATCH|DUPLICATE_REF, hint }]
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reconcile_results ON reconcile_results(stat_date, reconcile_type);
```

### P6 · `realm_templates` 建表 + `characters` 加列
```sql
CREATE TABLE IF NOT EXISTS realm_templates (
  id bigserial PRIMARY KEY,
  realm_level int NOT NULL,
  realm_name varchar(50) NOT NULL,
  required_value bigint DEFAULT 0,
  consume_items_json jsonb DEFAULT '[]',
  stat_bonus_json jsonb DEFAULT '{}',
  milestone_reward_json jsonb DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_realm_templates_level ON realm_templates(realm_level);

ALTER TABLE characters ADD COLUMN IF NOT EXISTS realm_level int DEFAULT 1;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS realm_value bigint DEFAULT 0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS milestone_claimed_json jsonb DEFAULT '{}';
```

### P7 · `encounter_templates` + `player_explorations` 建表
```sql
CREATE TABLE IF NOT EXISTS encounter_templates (
  id bigserial PRIMARY KEY,
  scene_id varchar(64) NULL,
  title varchar(100) NOT NULL,
  desc_text varchar(500) DEFAULT '',
  trigger_rate double precision DEFAULT 0.1,
  cd_seconds int DEFAULT 300,
  choices_json jsonb DEFAULT '[]',
  is_one_time boolean DEFAULT false,
  reward_json jsonb DEFAULT '{}',
  is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS player_explorations (
  id bigserial PRIMARY KEY,
  player_id varchar(64) NOT NULL,
  scene_id varchar(64) NOT NULL,
  times int DEFAULT 1,
  discovered_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_player_explorations ON player_explorations(player_id, scene_id);
```

> P2（replay）与 P4（dashboard）**无 DDL**：只读复用现有表（`risk_wash_flows` / `transactions` / `player_currencies` / `auth_accounts`）。

---

## 3. 配置键（`remote_configs`，需按运营值写入）

| 键 | 用途 | 建议 |
|---|---|---|
| `explore.milestone` | 探索首探里程碑奖励 json | 按策划配置（如 `{"firstSceneReward":{"items":[{"itemId":1,"qty":1}]}}`） |
| `explore.weather` | 天气态可选（如 `rainyTriggerBonus` 雨天奇遇加成） | 可后置 |

> `realm` 无配置键（境界由 `realm_templates` 表承载，见 §4 种子）。
> `risk.*`（P1/P2/P3 复用）**已在线上配置**，无需重复写。

---

## 4. 种子数据（新模板表需预置，否则功能"无内容"）

- **`realm_templates`**：至少预置 2–3 档境界（level 1 常设 `required_value=0`，level 2/3 给 required_value / 消耗道具 / 属性加成 / 里程碑奖励）。用 admin 接口 `POST /api/admin/v1/realm/template` 或直接 SQL 插入。
- **`encounter_templates`**：按场景预置奇遇（trigger_rate / cd / choices / reward）。用 admin 接口 `POST /api/admin/v1/explore/encounter-template` 或 SQL。
- `player_explorations` / `risk_identity_links` / `reconcile_results`：由运行自增，无需种子。

---

## 5. 冒烟验证（部署后，odoo 上）

```bash
# 需要先确认 odoo 上已有冒烟基础（注册/登录/likely 场景见脚本既有段 1-17）
bash /tmp/smoke-stage5b.sh
```

重点断言本次新增段（P1–P7）：
- P1: `POST /api/admin/v1/risk/cases/:id/recover` 扣款 economy_ref_id；`rollback` 退回；`lock` 封禁
- P2: `POST /api/admin/v1/risk/replay` 空窗口 hitAccounts=[]；非法 override 92901
- P3: 两同 IP 测试号后 `GET /api/admin/v1/risk/identity/player/:playerId` 互为 peer
- P4: `GET /api/admin/v1/economy/dashboard` 结构非空、currencyStats 有金
- P5: `POST /api/admin/v1/reconcile/run` results 非空、`GET .../results` 200
- P6: cultivate+breakthrough 到档位 2 → realm_level 与里程碑奖励已发且不重复
- P7: discover 幂等、encounter 可选状态、`GET /api/client/v1/explore/state` 含昼夜

> 冒烟段 18/19（P6/P7）用 `scenes`/realm 种子首条 id，若线上缺场景/模板会失败——先按 §4 预置。

---

## 6. 部署后核对项（checklist ✓）

- [ ] 服务 `game-server` active、`:3000` 监听
- [ ] `journalctl` 无 `QueryFailedError` / `UnknownExportException`（历史教训：Nest 不能 exports 实体类）
- [ ] §2 表/列已建（`\dt` / `\d risk_recover_records` 核对）
- [ ] §3 配置键已写、§4 种子已预置
- [ ] 冒烟全量 PASS（含 18/19 段）
- [ ] 手册无需再动（P1–P7 已同步）

---

## 7. 风险与提醒

1. **重启即自动同步 schema**：会加列/建表为**增量不破坏现有数据**（全为 ADD/CREATE），不影响既有业务表。
2. **economy 扣款非跨模块 DB 事务**（P1 用 per-account redis 锁 + 流水号回滚）：回收/回滚的单笔原子性有保证，但若追求多操作真事务需后续给 EconomyService 加 manager 参数。
3. **P6 属性加成取 delta 覆盖式叠加**：已在代码层处理旧境界残留；上线后先在测试号验一次突破，确认属性无残余再加量。
4. 若某表名/列与实际实体有出入，以 `packages-game/game-server/src/modules/*/entities/*.entity.ts` 为准（§2 由实体聚合而来）。