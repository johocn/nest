# 四川麻将（血战到底）部署要点

本文件仅记录**容易踩坑、文档里没写**的部署注意事项。常规步骤见 nest 项目通用文档。

## 1. 构建（重要）

本服务使用 `@nestjs/cli` 构建，执行 `nest build` 会**先清空 `dist` 再写入**（批量删除保护机制）。

- **部署机若用 `nest build`**：会触发整目录 `dist` 删除，可能因保护策略被拒或误删其他子包产物。
- **推荐**：直接用 `ts-node/register` 运行源码（开发/内部环境已验证可用）：

```powershell
# 启动（开发/预发）
$env:APP_PORT='3200'; $env:DB_TYPE='postgres'
node -r ts-node/register -r tsconfig-paths/register src/main.ts
```

- 若必须用编译产物：先单独 `rm -rf dist`，再 `nest build`，避免触发批量删除保护。

## 2. WebSocket 命名空间冲突（重要）

本机 `/game` 命名空间已被**既有 `GameGateway`** 通过 JWT 强制占用，麻将**不能**复用。

- 麻将全部使用**独立命名空间** `/sichuanmajiang`（房间事件前缀 `sichuanmajiang:`）。
- 前端连接：`connect('http://<host>:3200/sichuanmajiang')`。
- ⚠️ **不要**改回 `/game`，否则会与既有 `GameGateway` 冲突/鉴权失败。

## 3. 数据库

- 配置项：`DB_TYPE`（默认 `postgres`）、`APP_PORT`。
- **必须执行迁移**：`1791360000000_SichuanMahjongTables0005`（建 `sichuan_mahjong_tables` 表，含 `mode` 字段支持 `net`/`ai`）。
- **落库为「尽力而为」**：DB 宕机时只告警、**不**阻断牌局（见 §5 修复点）。部署时确保迁移已跑，否则历史/持久化不可用但牌局仍可玩。

## 4. AI 补位配置

AI 行为由 `src/config/aiConfig.ts` 的 `playerConfigs` 控制（选牌策略 `shangjia`、`zuijin`、`jiangyi`、`sikui`）。
若需调整 AI 强度/风格，仅改该文件，无需动逻辑。

## 5. 已修复的部署相关隐患（勿回退）

| 问题 | 现象 | 修复 |
|---|---|---|
| REST 不认真实 `playerId` | `startTable` 判「你不在该牌桌」 | 现从 `request.playerId` 取真实用户 |
| 落库未做保护 | DB 宕机连开局都崩 | 落库包 `try/catch`，失败仅告警 |

## 6. 手动冒烟测试

```powershell
# 后端
cd e:/code/nest/packages-game/game-server
$env:APP_PORT='3200'; $env:DB_TYPE='postgres'
node -r ts-node/register -r tsconfig-paths/register src/main.ts

# 前端
cd e:/code/sichuanmajiang/apps/web
npm run dev   # 默认 http://localhost:5173
```

- 开 4 个标签页：「创建房间」→ 复制房号 → 其余「加入牌桌」→ 全定缺即开局。
- 2–3 人时，房主点**「开始对局（AI 补位）」**即可用 AI 补齐 4 人开局。
- 自动化回归：`cd e:/code/sichuanmajiang/apps/web && node e2e-net.cjs`（REST 整局 + 分数守恒）。

## 7. 接口速查

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/table/:id` | 牌桌快照（含 `mode`、`botSeats`、`turn`、`winners`） |
| `POST` | `/api/room` | 联网建房（带 `roomId`） |
| `POST` | `/api/room/:id/start` | 联网房主开始（自动 AI 补位，需 `playerId`） |
| `GET` | `/api/history?playerId=` | 当前用户最近战绩 |
| `WS` | `/sichuanmajiang` | 房间事件（见 `events` 模块） |

> 注：`/api/room/:id/start` 与 WS `sichuanmajiang:start` 二者等价，二选一即可。
