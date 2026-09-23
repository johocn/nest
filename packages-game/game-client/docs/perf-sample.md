# S8 性能基线测量记录

本文件由 `scripts/perf-sample.mjs` **追加**写入（不覆盖历史）。

口径：指标沿用总纲 §12（H5 60fps / ≤60 drawcall、小游戏 30fps / ≤40 drawcall、内存 ≤300MB、上行 ≤10 次/秒/人）。

> 重要：首段基线是在**加了性能面板之后、任何渲染/同步优化之前**采集的（面板本身开销已计入）。

## baseline · 2026-09-23T07:00:59.215Z

- commit: `c65dd41d6`（工作区脏：是）
- 浏览器: Chromium/151.0.7922.34 · headless=否 · map-localhost-ipv4=是
- userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36`
- 打开地址: http://localhost:5173/（--quality 未指定（走平台默认））
- 质量日志: `[S8] quality=high switches=nameLabels=1 gridLines=1 triggerOutline=1 interp=full remoteHz=10 (platform=h5 url=- env=- config=auto)`
- 场景: [S1] 静态层渲染完成：地形 1280x960，物件 10，NPC 3，触发器 2，出生点 (640,480)
- 路线: ArrowRight 1.9s → ArrowDown 1.9s → ArrowLeft 1.9s → ArrowUp 1.9s → ArrowRight 2.4s（共 10s），随后静止 10s

### 每秒采样

| 段 | t(s) | fps(自计) | statFps | drawcall | 实体总 | 可见 | up/s | heap(MB) |
|---|---|---|---|---|---|---|---|---|
| 移动 | 1 | 60 | 60 | 37 | 17 | 17 | 10 | 19.1 |
| 移动 | 2 | 60 | 60 | 37 | 17 | 17 | 9 | 19.7 |
| 移动 | 3 | 60 | 60 | 35 | 17 | 17 | 10 | 20.2 |
| 移动 | 4 | 60 | 60 | 34 | 17 | 17 | 9 | 20.7 |
| 移动 | 5 | 60 | 60 | 34 | 17 | 17 | 10 | 21.2 |
| 移动 | 6 | 60 | 60 | 34 | 17 | 17 | 9 | 21.7 |
| 移动 | 7 | 60 | 60 | 34 | 17 | 17 | 10 | 22.1 |
| 移动 | 8 | 60 | 60 | 34 | 17 | 17 | 10 | 19.5 |
| 移动 | 9 | 60 | 60 | 37 | 17 | 17 | 10 | 20 |
| 移动 | 10 | 60 | 60 | 35 | 17 | 17 | 10 | 19.7 |
| 静止 | 1 | 60 | 60 | 34 | 17 | 17 | 0 | 20 |
| 静止 | 2 | 60 | 60 | 34 | 17 | 17 | 0 | 20.4 |
| 静止 | 3 | 60 | 60 | 34 | 17 | 17 | 0 | 20 |
| 静止 | 4 | 60 | 60 | 34 | 17 | 17 | 0 | 20.2 |
| 静止 | 5 | 60 | 60 | 34 | 17 | 17 | 0 | 20.5 |
| 静止 | 6.1 | 60 | 60 | 34 | 17 | 17 | 0 | 20.7 |
| 静止 | 7.1 | 60 | 60 | 34 | 17 | 17 | 0 | 20.2 |
| 静止 | 8.1 | 60 | 60 | 34 | 17 | 17 | 0 | 20.4 |
| 静止 | 9.1 | 60 | 60 | 34 | 17 | 17 | 0 | 20.6 |
| 静止 | 10 | 60 | 60 | 34 | 17 | 17 | 0 | 20.8 |

### 汇总

- 移动段 fps：均值 **60** · 最低 **60**（目标 60）
- 静止段 fps：均值 **60**
- drawcall 峰值：**37**（目标 ≤60）
- heap 峰值：**22.1** MB（目标 ≤300MB）
- 移动段 up/s 均值：**9.7**（目标 ≤10）
- 静止段 up/s 合计：**0**（应 ≈0）
- 结束档位：**high**

## pool · 2026-09-23T07:20:35.008Z

- commit: `42028b28c`（工作区脏：是）
- 浏览器: Chromium/151.0.7922.34 · headless=否 · map-localhost-ipv4=是
- 打开地址: http://localhost:5173/
- 参数: cycles=100（A/B 各 1 组；页内驱动构建产物 /js/entity/EntityPool.js + /js/world/entity-pool-adapter.js）
- userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36`

### A 组（池化：acquire → release × 100）

- stats(player): `{"created":1,"reused":99,"pooled":1,"live":0,"discarded":0}`（期望 created=1 / reused=99 / pooled=1 / live=0 / discarded=0）
- 第 1 次与第 100 次 sprite 引用相同：**是**
- drawcall：前 **37** → A 后 **37**
- heap 中位：18.7 MB → 19.1 MB（Δ=0.4 MB）

### B 组（对照：create 且保留引用 × 100）

- heap 中位：19.4 MB → 20.4 MB（Δ=1 MB）
- drawcall：B 后 37（新实体未入场景层，故不变）

> heap 为**参考值**：app 自身仍在运行、GC 时机不定；读数取「前后各让出若干帧 + 5 次采样中位」，不代表精确分配量。

### reset 字段断言（风险 #2：幽灵实体）

- 复用同一实例：**是**
- 弄脏时的值：name="GHOST" pos=(9999,9999) rotation=45 visible=false 任务标记可见=true
- reset 后的值：name="玩家ghostLoop" pos=(5,6) rotation=0 visible=true 任务标记可见=false
- 期望值：name="玩家ghostLoop" pos=(5,6) rotation=0 visible=true 任务标记可见=false
- sprite 子节点数：脏态 2，8 轮「弄脏→release→acquire」后记录 = [2,2,2,2,2,2,2,2]（不增长=**是**）
- graphics 命令数：基线 2 → 脏 1 → reset 后 2

### 结论

- 全部断言通过（共 15 项）
- 池化把 100 次「进出视野」从 100 次分配压到 1 次（created=1 / reused=99），sprite/Text 全程同一引用，无幽灵状态残留。
