# 社交驱动游戏服务器 · 开发计划（分阶段设计）

- 版本：v1.0
- 日期：2026-09-19
- 项目：game-server（NestJS 11 + TypeORM + Redis + Socket.IO，部署于 game.joho.cn）
- 依据：《游戏服务器开发手册》（HTML 版 game.joho.cn/manual/，Markdown 备份 game.joho.cn/manual/游戏服务器开发手册.md）

## 1. 背景与目标

**现状**：game-server 已有 30 个模块、64 张表、158 个接口的完整骨架（auth/player/character/inventory/combat/social/trade/ranking/world 等），可玩闭环已具备。

**愿景**：按《开发手册》17 章将游戏深化为「社交驱动」武侠世界——社交动作（刺探/打听/发广告/揭榜/逛街等）是核心玩法，产出情报/声望/人情/资源，推动剧情与修炼，反哺更高级社交场景。

**计划本质**：从现有骨架到社交驱动愿景的分阶段深化路线，每阶段可独立上线验证。

**核心约束**：
- 1G 内存服务器：本地构建 dist，服务器仅 `npm install --omit=dev`；禁止服务器构建
- 生产已在运行：增量扩展优先，不重构既有系统
- TypeORM synchronize=true：新表自动创建，只加不删；枚举只加值不删值
- 部署流程：pg_dump 备份 → 本地构建 → scp + 保留旧 dist → systemd 重启 → 接口冒烟，失败回滚

## 2. 四阶段总纲

| 阶段 | 范围（手册章节） | 关键交付 | 验收标准 |
|---|---|---|---|
| 1 骨架补缺 | 2.5-2.8 / 3.12-3.13 / 5.15-5.20 / 11.12 | 社交货币体系 / 账号安全与封禁链 / 角色名片 / 场景物件互动 | 手册 1-5 章全落地；阶段 1 接口冒烟全绿；单元测试全绿 |
| 2 社交核心 | 第 8 章（8.6 情报 / 8.7 关系 / 8.18-8.22 帮派） | 情报生态 / 关系养成 / 帮派全生命周期 | 七日社交引导可走通；「社交→产出→成长」闭环 MVP |
| 3 社交×系统联动 | 6.19-6.25 / 7.4-7.9 / 11.3-11.13 | 社交战斗 / 社交任务 / 社交经济 | 三类联动闭环全通；平衡体检 15.8 四象限达标 |
| 4 运营与治理 | 13.6-13.8 / 14.8-14.12 / 15.8 | 活动工作台 / 社区运营 / 社交数据分析 / 聊天深化 | 运营看板当天可见；新玩家 7 日关系建立率 ≥ 60% |

## 3. 阶段 1 详细设计（C → A → D → B）

范围：仅增量扩展，不重构既有系统。实施顺序按依赖：社交货币（被依赖基础）→ 账号安全 → 角色名片 → 场景物件（最独立）。

### 3.1 迭代 C · 社交货币（economy 模块）

**目标**：11.12 多币种落地——人情值/帮贡/颜面三社交货币 + 兑换铁律（社交货币只能通过社交获取）。

- 枚举扩展：`CurrencyType += FAVOR('favor' 人情值) / GUILD_CONTRIB('guild_contrib' 帮贡) / FACE('face' 颜面)`
- 兑换铁律（服务端强校验，不依赖前端）：
  - FAVOR / GUILD_CONTRIB / FACE 禁止互相兑换
  - 三社交币禁止与金币 GOLD、钻石 DIAMOND、绑定钻 BOUND_DIAMOND 兑换
  - 保留钻石 ↔ 绑定钻可兑（11.12 兑换表）
- 表：无新表（复用 Transaction 表 + player 余额 + economy.service 现有 addCurrency/扣减通用机制）
- 新增接口：
  - `GET /economy/social/balances` —— 三社交币余额
  - `POST /economy/exchange` —— 兑换（铁律校验，仅非社交币可兑）
- 扩展点：eventBus 预留事件 `FAVOR_GAINED` / `GUILD_CONTRIB_GAINED` / `FACE_CHANGED`（阶段 2/3 由送礼/帮贡/颜面系统消费，解耦可插拔）

### 3.2 迭代 A · 账号安全（auth 模块）

**目标**：2.5-2.8 落地——异地风控 / 分级封禁链 / GM 权限 / 实名防沉迷。

- 异地登录风控：
  - 登录时比对 `account_login_logs.login_ip`（已有表）最近记录
  - 异 IP / 高频登录失败触发验证（验证码或二次验证）
  - 新表 `account_security_events`（风控事件留痕：type/ip/device/result/created_at）
- 分级封禁处置链（警告 → 禁言 → 帮派除名 → 限交易 → 封禁）：
  - 新表 `account_penalties`（player_id / level / reason / until / created_by / created_at）
  - `auth_accounts += muted_until / trade_locked_until`（快速校验冗余列）
  - 按当前 level 幂等升级（不叠加不降级）；到期自动解除；处置全程留痕
  - 封禁链涉及「帮派除名」在阶段 2 帮派系统接入后挂钩（先记录占位）
- GM 权限：`AdminRole` 已有 SUPER_ADMIN/ADMIN/OPERATOR/VIEWER 四级，补权限矩阵（operator 可发处置/仲裁，viewer 只读）
- 实名防沉迷：`auth_accounts += real_name(加密) / id_no_hash / anti_addiction_on`；real_name 用 AES 加密存储、id_no 仅存 hash、接口脱敏
- 新增接口：
  - `POST /auth/security/verify` —— 风控验证
  - `POST /auth/admin/penalties` —— GM 分级处置
  - `GET /auth/admin/penalties/:playerId` —— 处置记录查询
  - `POST /auth/realname` —— 实名绑定
- 依赖：迭代 C（封禁可扣减/恢复社交货币，仅内部调用）

### 3.3 迭代 D · 角色名片（character 模块）

**目标**：3.12-3.13 落地——外观名片 / 叙事身份（名号/诗号/社交史）/ 称号系统。

- 档案扩展：`character_profile += alias(名号) / poem(诗号) / social_bio(jsonb 社交史)`
- 称号系统：
  - 新表 `title_templates`（id / name / icon_url / condition / reward_json / sort_order）
  - 新表 `character_titles`（player_id / title_id / is_equipped / obtained_at）
  - 获取来源事件占位（阶段 2/3 由成就/帮派/榜单系统发放）
- 外观名片：炫耀/展示消耗 FACE（颜面值，依赖迭代 C）
- 新增接口：
  - `PUT /character/card` —— 设置名号/诗号
  - `POST /character/titles/equip` —— 装备/卸下称号（唯一性校验）
  - `GET /character/card/:id` —— 他人名片浏览（含名号/称号/社交史摘要）
- 依赖：迭代 C（FACE 消耗）

### 3.4 迭代 B · 场景物件（world 模块）

**目标**：5.15-5.20 落地——物件互动 / 机关谜题 / 生物坐骑 / 街头玩法 / 地标 / 资源点接入。

- 物件互动：
  - 新枚举 `InteractType`（collect / hide / camp / sit / lie / carve / read / mount / fish / play …）
  - `POST /world/objects/:id/interact` —— 统一互动入口：校验 `object_templates.interact_cd`（冷却）、`is_one_time`（一次性）、`reward`（产出）
  - 资源产出统一过 `ResourceBalancePolicy`（已实现：效率递减 / 退化 / 日产量上限）
- 机关谜题：
  - `TriggerType += puzzle / gate / trap`（复用 `scene_trigger` 表）
  - `POST /world/triggers/:id/activate` —— 多人配合站位解锁；破解广播
- 生物坐骑：新表 `player_mounts`（player_id / mount_id / is_active / obtained_at；信鸽传书挂载）
- 街头玩法：新表 `street_games`（type: fishing/chess/archery/cricket/ring）+ `game_sessions`（围观下注、胜负结算）
- 地标：`ObjectType += LANDMARK`；路牌留言 / 瞭望塔 / 驿站互动（复用 object_templates + interact 机制）
- 资源点：接入已实现 `ResourceBalancePolicy`（efficiencyFactor / degradedYield / dailyCapExceeded）
- 新增接口：
  - `POST /world/objects/:id/interact`
  - `POST /world/triggers/:id/activate`
  - `POST /world/mounts/equip` / `POST /world/mounts/ride`
  - `POST /world/games/start` / `POST /world/games/bet` / `POST /world/games/finish`
  - `POST /world/landmarks/:id/message`（路牌留言）
- 依赖：无（复用 resource-balance.policy 已有实现）

## 4. 阶段 2-4 概要设计

### 4.1 阶段 2 · 社交核心（里程碑级）

| 迭代 | 关键交付 | 依赖 |
|---|---|---|
| 2-1 情报生态（8.6） | 刺探/打听/窃听 + 情报价值分级 E~A + 谍报成长（复用 character_espionage）+ 情报交易市场 | 阶段 1 C |
| 2-2 关系养成（8.7） | 好感度五阶段（复用 character_relationship）+ 结义/师徒/侠侣 + 送礼回礼（FAVOR） | 阶段 1 C |
| 2-3 帮派全生命周期（8.18-8.22） | 建帮/职位/弹劾 + 驻地建设 + 活动日历 + 外交信誉 + 帮贡经济（GUILD_CONTRIB） | 阶段 1 C；2-2 |

验收：七日社交引导（15.3）可走通；「社交→产出→成长」闭环 MVP。

### 4.2 阶段 3 · 社交×系统联动（里程碑级）

| 迭代 | 关键交付 | 依赖 |
|---|---|---|
| 3-1 社交战斗（6.19-6.25） | 阵法/合击（默契递进）+ 援护分工 + 颜面值 + 战利品分配仪式 + 说和仲裁 | 阶段 1 C；2-2 |
| 3-2 社交任务（7.4-7.9） | target_json 社交目标（刺探/送礼/组队/帮贡）+ 剧情社交解锁 + 卡关求助 | 2-1；2-3 |
| 3-3 社交经济（11.3-11.13） | 议价/担保交易/赊账（FAVOR 担保）/悬赏委托/以物易物 | 阶段 1 C；2-2 |

验收：三类联动闭环全通；平衡体检 15.8 四象限达标（战斗/经济/成长/社交）。

### 4.3 阶段 4 · 运营与治理（里程碑级）

| 迭代 | 关键交付 | 依赖 |
|---|---|---|
| 4-1 活动工作台（13.6） | 预配置→灰度→回滚流水线 + 数据看板当天可见 | 阶段 1 A |
| 4-2 社区运营（13.7） | 公告互动/建议箱闭环/玩家大使 | — |
| 4-3 社交数据分析（13.8） | 关系图谱/流失预警/7 日社交建立率指标 | 2-1/2-2 |
| 4-4 聊天频道深化（14.8-14.12） | 频道玩法/江湖热搜/语音陪伴/频道自治/客服引导 | chat 已有；社交货币打赏 |

验收：运营看板当天可见；新玩家 7 日关系建立率 ≥ 60%。

### 4.4 共享基础设施与阶段衔接

- 社交货币（迭代 C）是 4 阶段共用地基：FAVOR/GUILD_CONTRIB/FACE 贯穿送礼/帮贡/颜面/打赏全部社交消费
- 事件总线串联：阶段 1 预留的 FAVOR_GAINED 等事件在阶段 2/3 由各系统消费
- 每阶段独立上线：阶段间无强耦合，阶段 2 起可边运营边深化
- 手册即验收清单：每阶段完成后跑 check.js 核对手册引用一致，数据字典同步更新

## 5. 测试策略

- **单元测试（每迭代）**：
  - C：兑换铁律（社交币互兑拒绝、社交币↔金币互兑拒绝、钻石↔绑定钻可兑）；余额/流水正确
  - A：封禁链分级与到期自动解除；风控触发（异 IP/高频失败）；幂等升级
  - D：称号唯一性/装备校验；颜面扣减；名号/诗号长度与敏感词
  - B：interact_cd 冷却校验；is_one_time 一次性；资源策略折算（效率递减/退化/日上限）
- **回归**：既有 modules 测试全量跑通不破坏（economy/character/auth/world 原有 spec）
- **联调冒烟**：本地启动后按新增接口清单逐一 curl（状态码 + 业务断言），通过后再部署

## 6. 部署方案（阶段 1 整体上线）

1. **备份**：pg_dump 全库备份（社交数据不可重建）
2. **构建**：本地 `npm run build`；tar 打包 dist
3. **上传**：scp dist → 服务器；保留上一版 dist 副本（回滚用）
4. **启动**：systemd restart game-server；TypeORM synchronize=true 自动建新表/扩枚举（只加不删）
5. **验证**：game.joho.cn 新接口逐一 curl 冒烟；失败回滚上一 dist

## 7. 风险与护栏

| 风险 | 护栏 |
|---|---|
| synchronize 生产建表意外 | 先备份；新列仅 nullable/default；枚举只加值不删值 |
| 实名信息泄露 | real_name AES 加密存储、id_no 仅存 hash、接口脱敏 |
| 兑换铁律绕过 | 服务端强校验；兑换走统一 economy.service 网关 |
| 封禁处置叠加/误封 | 按当前 level 幂等升级；处置全程留痕；申诉通道 + 自动到期 |
| 资源点刷产出 | 互动物件统一过 ResourceBalancePolicy |
| 1G 内存 | 本地构建；服务器仅 `npm install --omit=dev`；swap 已配 |
| 部署失败 | 保留上一 dist；systemd 失败自动回滚重启旧版 |

## 8. 验收标准汇总

- 阶段 1：手册 1-5 章全落地；阶段 1 新增接口冒烟全绿；单元测试全绿；既有测试回归通过
- 阶段 2：七日社交引导可走通；社交→产出→成长闭环 MVP
- 阶段 3：三类联动闭环全通；平衡体检 15.8 四象限达标
- 阶段 4：运营看板当天可见；新玩家 7 日关系建立率 ≥ 60%
