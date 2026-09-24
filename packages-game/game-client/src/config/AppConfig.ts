export const AppConfig = {
  /** 客户端版本（展示用） */
  clientVersion: '0.1.0-s1',
  /**
   * S8 质量档位默认值：`auto` = 交给 `perf/Quality.resolveTier` 按平台解析
   * （小游戏 low、H5 high）。这里不直接写 `isMiniGame()? 'low':'high'`：
   * AppConfig 是纯常量字面量、被 Platform 反向 import，import Platform 会成环（S8 Task 1 已确认的合理偏离）。
   * 运行期覆盖优先级：URL `?quality=` > `__ENV__.quality` > 本字段（非 auto）> 平台默认。
   */
  quality: 'auto' as 'auto' | 'high' | 'low',
  /** HTTP 接口根地址（后端无 global prefix） */
  apiBase: 'http://localhost:3000',
  /** socket.io 地址：namespace /game */
  wsUrl: 'http://localhost:3000/game',
  /**
   * 配置包根路径：必须是**同源**路径。
   * 生产页面与 /gamedata 同域；本地开发由 tools/serve.mjs 把 /gamedata 反向代理到后端 :3000。
   * 不可用 `${apiBase}/gamedata`：/gamedata 静态响应不带 CORS 头（main.ts 中 useStaticAssets 先于 enableCors），
   * 跨源直连会被浏览器拦截（已实测 blocked by CORS policy）。
   */
  configBase: '/gamedata',
  /** 资源根路径（Laya.URL.basePath 用，必须以 / 结尾） */
  assetBase: '/assets/',
  /** 舞台尺寸（spike 用固定尺寸，缩放交给引擎 scaleMode） */
  stageWidth: 960,
  stageHeight: 640,
  /** 移动上报间隔（毫秒）与最小位移阈值（像素） */
  moveReportIntervalMs: 100,
  moveReportThreshold: 4,
  /**
   * S8 Task 5：本地移动改**时间基**（D7）。基线是帧基 `4px/帧`，帧率不同速度不同
   * （小游戏 30fps 只有一半速度），故改为 `px/ms` 由 `Laya.timer.delta` 提供。
   *
   * **等价关系（必须逐字等价，否则 H5 既有手感回退）**：`4px/帧 @60fps` = 4 ÷ (1000/60) = **0.24px/ms**
   * = 240px/s；30fps 下 delta=33.33ms → 单帧 8px（两帧赶上 60fps 的一帧×2）。
   * ⚠️ 计划正文写作「≈0.0667px/ms」是笔误（0.0667 = 4/60，把「帧」当成了毫秒），照抄会让本地玩家
   * 速度降到 1/3.6 —— 违反「H5 既有行为不改」（§0.4），故按计划 Step 3 的「等价 4px/帧@60fps」取 0.24。
   */
  moveSpeedPxPerMs: 0.24,
  /** 就近交互半径（像素）：按目标类型取值，人（NPC）比物远一点，避免「隔老远也能交互」 */
  interactRadiusNpc: 90,
  interactRadiusObject: 70,
  /** 设备标识：后端 DTO 未标 @IsOptional，不传会 400（见 §1.2） */
  deviceId: 'laya2d-s1',
  /**
   * HUD（引擎内自绘）常量：尺寸/位置/颜色集中在此，避免魔法数字散落各处。
   * 全部是**舞台坐标**（Hud 挂 Laya.stage 顶层，不随世界层滚动）。
   */
  hud: {
    /** HUD 根节点 zOrder：须大于世界层，保证盖在场景之上 */
    zOrder: 9999,
    /** toast：屏幕中上部（stageHeight 的比例）、默认时长与内边距 */
    toastTopRatio: 0.22,
    toastMs: 2000,
    /** Toast.error 用的较长时长（沿用 S1 的 3600ms） */
    toastErrorMs: 3600,
    toastFontSize: 16,
    toastPadX: 14,
    toastPadY: 8,
    toastBgColor: 'rgba(0,0,0,0.75)',
    toastTextColor: '#ffffff',
    /** hint：底部固定提示条，底边距、最大宽度、最大行数（超出截断）、字号与内边距 */
    hintBottomOffset: 24,
    hintMaxWidth: 640,
    hintMaxLines: 3,
    hintFontSize: 14,
    hintPadX: 12,
    hintPadY: 8,
    hintBgColor: 'rgba(0,0,0,0.75)',
    hintTextColor: '#e6edf3',
    /** highlight：选中目标脚底光圈 */
    highlightRadius: 22,
    highlightColor: '#ffd75e',
    highlightLineWidth: 2,
  },
  /**
   * S5 对话框（引擎内自绘，屏幕空间）：与 hud 同风格，常量集中在此避免魔法数字散落。
   * 面板宽度与位置按 stage 尺寸计算，`layoutDialogue` 是消费这些常量的纯函数（可被断言脚本 import）。
   */
  dialogue: {
    /** 对话框根节点 zOrder：须盖在 HUD 之上 */
    zOrder: 10000,
    /**
     * 面板宽度上限。**上限受触控层几何约束**：面板水平居中（占 x (960−w)/2 .. (960+w)/2），
     * 而摇杆激活区占左下 x 0..256（见下方 `touch.stickZoneWidth`）、交互按钮占 x 848..936。
     * 两条约束：
     *  - **左缘 ≥ 256** → `w ≤ 448`：面板左缘再往左就会压进摇杆激活区，其上的选项按钮（在触控层之上）
     *    会抢走按下事件，表现为「想走路却误选了对话选项」；
     *  - 右缘 ≤ 736 → 让开右下角交互按钮（取 448 时右缘 704 < 848，余量充足）。
     * 故取 **448**：左缘 256 与激活区右界**恰好贴齐、零重叠**，右缘 704 让开交互按钮。
     */
    panelMaxWidth: 448,
    panelMarginX: 40,
    panelBottomOffset: 24,
    panelBgColor: 'rgba(0,0,0,0.88)',
    panelBorderColor: '#4a5568',
    panelBorderWidth: 2,
    padX: 16,
    padY: 12,
    /** 说话人一行与正文之间的间距 */
    gapAfterSpeaker: 6,
    /** 正文与选项（或错误行）之间的间距 */
    gapBeforeOptions: 8,
    speakerFontSize: 15,
    speakerColor: '#ffd75e',
    bodyFontSize: 14,
    bodyColor: '#e6edf3',
    bodyLineHeight: 20,
    optionFontSize: 14,
    optionColor: '#8ecdf7',
    /** 选项行高（S9 第三轮起 22 → 44：手机上 22 只有 8.9 CSS px，手指点不准；面板自底向上生长，不会溢出） */
    optionHeight: 44,
    optionGap: 4,
    optionBgColor: 'rgba(255,255,255,0.06)',
    optionPadX: 8,
    errorFontSize: 14,
    errorColor: '#ff7b72',
    /** 数字键 1-9 可选的最大选项数 */
    maxOptions: 9,
  },
  /**
   * S6 建造面板（引擎内自绘，屏幕空间）与建筑表现常量：与 hud/dialogue 同风格，常量集中避免魔法数字散落。
   */
  build: {
    /** 建造面板根节点 zOrder：须盖在 HUD 与对话框之上 */
    zOrder: 10001,
    /** 面板贴右侧：宽度与四周边距 */
    panelWidth: 320,
    panelMargin: 12,
    panelBgColor: 'rgba(0,0,0,0.85)',
    panelBorderColor: '#4a5568',
    panelBorderWidth: 2,
    padX: 12,
    padY: 10,
    titleFontSize: 16,
    titleColor: '#ffd75e',
    lineFontSize: 13,
    lineColor: '#e6edf3',
    dimColor: '#8b949e',
    lineHeight: 20,
    /**
     * **可点行的行带高度（S9 第三轮）**：蓝图行（选蓝图）与操作按钮行（建造/投料/拆除/关闭）都用它。
     * 理由：手机上 20 舞台像素只有 **8.1 CSS px**、手指点不准 —— 而面板的行带是**连续无缝**的，
     * 「命中区加高」在相邻行都可点时最多只能吃半个行距（实测中间行仍是 20）→ 只能把**视觉行带本身**加高。
     * 44 ≈ 18 CSS px，与触控按钮同量级；面板因此变高（约 310 → 480），仍在 640 内。
     */
    touchRowHeight: 44,
    /** 蓝图行选中底色 */
    selectedBgColor: 'rgba(47,129,247,0.35)',
    /** 合法性红/绿 */
    legalColor: '#3fb950',
    illegalColor: '#ff7b72',
    /** 操作按钮行高与底色（S9 第三轮起 26 → 44，与 `touchRowHeight` 一致，手机上才点得准） */
    buttonHeight: 44,
    buttonBgColor: 'rgba(255,255,255,0.10)',
    /** 格点预览：半透明填充 + 边框 */
    previewAlpha: 0.35,
    previewLineWidth: 2,
    /** 建筑进度条（世界空间，画在建筑贴图上方） */
    progressBarWidth: 48,
    progressBarHeight: 6,
    progressBarOffsetY: -42,
    progressBgColor: 'rgba(0,0,0,0.6)',
    progressFgColor: '#3fb950',
    /** `finishAt` 缺失（不确定进度）时的中性色 */
    progressUnknownColor: '#8b949e',
    /** demolishing 淡出时长（毫秒），到点后从 EntityRegistry 移除 */
    demolishFadeMs: 400,
    /** 面板刷新节流：每 6 帧（≈100ms）重绘一次预览与进度 */
    refreshFrameInterval: 6,
  },
  /**
   * S7 登录页（引擎内自绘，屏幕空间；小游戏端无 DOM）：与 hud/dialogue/build 同风格，常量集中避免魔法数字散落。
   * `loginLayout` 是消费这些常量的纯函数（可被零依赖断言脚本 import）。
   */
  login: {
    /** 登录页根节点 zOrder：须盖在 hud(9999) / dialogue(10000) / build(10001) 之上 */
    zOrder: 10002,
    /** 面板：宽度上限与四周边距（窄屏按边距收窄），水平居中、垂直居中 */
    panelMaxWidth: 420,
    panelMarginX: 40,
    panelMarginY: 20,
    panelWidthMin: 200,
    panelBgColor: 'rgba(0,0,0,0.92)',
    panelBorderColor: '#4a5568',
    panelBorderWidth: 2,
    padX: 24,
    padY: 20,
    /** 标题 */
    titleFontSize: 20,
    titleColor: '#ffd75e',
    titleHeight: 30,
    gapAfterTitle: 12,
    /** 字段标签（画在输入框上方） */
    labelFontSize: 13,
    labelColor: '#8b949e',
    labelHeight: 18,
    gapAfterLabel: 4,
    /** 输入框 */
    inputHeight: 34,
    inputFontSize: 15,
    inputTextColor: '#e6edf3',
    inputBgColor: 'rgba(255,255,255,0.10)',
    inputFocusBgColor: 'rgba(47,129,247,0.25)',
    inputBorderColor: '#4a5568',
    inputFocusBorderColor: '#2f81f7',
    inputBorderWidth: 1,
    inputPadX: 8,
    /** 两个字段之间的行距 */
    gapBetweenFields: 12,
    /** 密码掩码与光标（引擎内无输入法，光标以竖线表示） */
    maskChar: '•',
    caretChar: '|',
    /** 提交按钮 */
    gapBeforeButton: 16,
    buttonHeight: 36,
    buttonFontSize: 16,
    buttonColor: '#ffffff',
    buttonBgColor: '#2f81f7',
    buttonDisabledBgColor: '#4a5568',
    buttonDisabledColor: '#8b949e',
    buttonIdleText: '登录 / 自动注册',
    buttonBusyText: '登录中…',
    /** 错误行（校验失败 / 提交异常） */
    gapBeforeError: 10,
    errorHeight: 18,
    errorFontSize: 13,
    errorColor: '#ff7b72',
    /** 输入长度上限（与 H5 表单标签口径一致：账号 3-32、密码 6-64） */
    maxUserLen: 32,
    maxPassLen: 64,
  },
  /**
   * S8 性能面板（引擎内自绘，屏幕空间）与质量分级参数：与 hud/dialogue/build/login 同风格，常量集中避免魔法数字散落。
   * 指标口径沿用总纲 §12：H5 60fps / ≤60 drawcall、小游戏 30fps / ≤40 drawcall、内存 ≤300MB、上行 ≤10 次/秒/人。
   */
  perf: {
    /** 面板根节点 zOrder：须高于 hud(9999)/dialogue(10000)/build(10001)/login(10002) */
    zOrder: 10003,
    /** 面板左上角位置与内边距（屏幕坐标） */
    x: 8,
    y: 8,
    padX: 8,
    padY: 6,
    fontSize: 13,
    bgColor: 'rgba(0,0,0,0.72)',
    textColor: '#e6edf3',
    /** 校验偏差超阈值时的标注色 */
    warnColor: '#ff7b72',
    /** 面板文本刷新间隔（毫秒）＝ fps 采样窗口；每帧只累加计数，不做重绘 */
    refreshMs: 1000,
    /** 自计 fps 与 `Laya.Stat.FPS` 的允许偏差：超过则在面板上标注（不报错） */
    statFpsTolerance: 3,
    /** 自动降级：目标帧率（按档位取）＋连续低于目标 ratio 的时长（D2 / 风险 #8） */
    targetFpsHigh: 60,
    targetFpsLow: 30,
    degradeRatio: 0.8,
    sustainMs: 3000,
  },
  /**
   * S8 实体对象池（Task 2）：与 hud/dialogue/build/login/perf 同风格，常量集中避免魔法数字散落。
   * 只池化**高频增删**实体（远端玩家 / 动态 NPC / 掉落物，D4）；静态物件与固定 NPC 不进池。
   */
  pool: {
    /** 每个 kind 桶的容量上限：超限的 release 直接丢弃并计入 discarded，防止长时间运行内存无界增长 */
    maxPerKind: 32,
  },
  /**
   * S9 手机触控（引擎内自绘，屏幕空间）：**浮动虚拟摇杆** + 交互按钮，**仅触摸设备显示**。
   * 只补输入通道：摇杆把与键盘同名的 `'w'/'a'/'s'/'d'` 按 8 向离散注入 `PlayerControl.pressed`，
   * 交互按钮走 `InteractController.triggerInteract()` —— 与键盘是同一条链路，PC 端行为零变更。
   * 尺寸均为**舞台坐标**（`SCALE_SHOWALL` 下随舞台等比缩放）。
   */
  touch: {
    /** 触控层根节点 zOrder：**低于** hud(9999) —— 提示条/对话/建造/登录/性能面板永远盖在它上面 */
    zOrder: 9998,
    /**
     * 摇杆激活区（左下角锚定）：**不可见但可命中**，手指在这块区域按下才生成底座与摇杆头。
     * 必须有实体节点接住按下 —— Laya 的拖动事件只向「按下时命中的节点链」派发，空处按下连 MOUSE_DOWN 都收不到。
     * **宽度取 256**：恰好等于对话面板左缘 x（见上方 `dialogue.panelMaxWidth` 的推导），
     * 使激活区与面板**零重叠** —— 在激活区内按下必定起摇杆，不会误选到压在上层的对话选项行。
     */
    stickZoneWidth: 256,
    stickZoneHeight: 400,
    /** 摇杆底座半径 / 摇杆头半径：摇杆头最大偏移 = 底座半径（超出按方向钳制在圆内） */
    stickRadius: 88,
    knobRadius: 36,
    /** 死区比例：偏移 < `stickRadius × 该比例` 时不注入任何方向键（防误触抖动） */
    deadZoneRatio: 0.28,
    /** 交互按钮尺寸与到右下角的边距 */
    interactWidth: 88,
    interactHeight: 88,
    interactMarginRight: 24,
    interactMarginBottom: 40,
    /**
     * 「建造」按钮到右下角的边距：与交互按钮**同宽同高**（复用 `interactWidth/Height/interactFontSize`），
     * 竖直叠放在交互按钮正上方（水平位置一致）。`152 = interactMarginBottom(40) + interactHeight(88) + 24(间距)`
     * → 按钮落在 `y 400..488`（与交互按钮同为 88×88）。
     * 面板打开时若被建造面板盖住，面板内已有「关闭面板」按钮行兜底（见 `BuildPanel.rows`）。
     */
    buildMarginBottom: 152,
    /** 半透明不挡视野；`pressedBgColor` 同时用作摇杆头底色 */
    bgColor: 'rgba(255,255,255,0.16)',
    pressedBgColor: 'rgba(255,255,255,0.42)',
    borderColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    /** 交互按钮字号 / 文字色 */
    interactFontSize: 20,
    textColor: '#ffffff',
    /**
     * **可点行的最小命中高度（舞台像素）**：触控下「点一下就有反应」的行把自己的命中区撑到至少这个高度。
     *
     * 为什么需要：`SCALE_SHOWALL` 把 960×640 等比缩到手机宽度，常见机型（如 390 CSS px 宽）
     * 缩放比只有 ~0.41 —— 20 舞台像素的行带落到屏幕上只有 **8.1 CSS px 高**，而手指落点误差普遍
     * >4 CSS px，表现就是「点了没反应」。交互按钮 `interactHeight=88`（≈36 CSS px）之所以一直好使，就是够高。
     * 取 **44**：≈18 CSS px，与 88 的交互按钮同一量级。
     *
     * **但命中区只解决「相邻有空隙」的行**：面板的行带是连续无缝的，相邻行都可点时只能各吃半个行距
     * （实测中间行仍是 20）—— 故 **S9 第三轮把可点行的视觉行带本身也加到了 44**
     * （`build.touchRowHeight` / `build.buttonHeight` / `dialogue.optionHeight`），本常量退化为兜底。
     */
    minHitHeight: 44,
  },
  /**
   * S8 Task 3 静态背景层（世界空间）：地块 + 网格 + 触发区描边 + 增量排序阈值集中在此，避免魔法数字散落。
   * **取值全部 = 优化前的字面量原值**（`'#2f6b3a'` / `'#3d7a4a'` / 1px / 100px / `'#f5c542'` / 2px），
   * 保证 `quality='high'` 与基线**表现逐字一致**（风险 #1 表现不回退）。
   */
  sceneBg: {
    /** 地块底色（原 `drawRect` 填充色） */
    groundColor: '#2f6b3a',
    /** 网格线：颜色 / 间隔 / 线宽（原 `drawLine` 三个参数） */
    gridColor: '#3d7a4a',
    gridInterval: 100,
    gridLineWidth: 1,
    /** 触发区描边：颜色 / 线宽（原 `drawRect(..., null, color, 2)` 的无填充描边） */
    triggerOutlineColor: '#f5c542',
    triggerOutlineWidth: 2,
    /** `resort()` 增量阈值（像素）：任一实体 y 位移 ≥ 该值才重排；越小越灵敏、越大越省 */
    resortMoveThreshold: 8,
    /** 静态背景合图缓存（`cacheAs='bitmap'`）：小游戏端 GPU 侧收益，关闭则退回逐条重绘 */
    cacheAsBitmap: true,
  },
  /**
   * S8 Task 4 视口裁剪（客户端先行，D5）：视口矩形 = 舞台尺寸 + 预加载边距，跟随本地玩家。
   * **只改 `sprite.visible`，绝不改坐标**（S1 验收按配置坐标核对，不看可见性 —— 计划风险 #4）。
   *
   * 事实备注（诚实记录，别当成「已优化」）：本 demo 地图 1280x960 / 舞台 960x640，`marginPx=200`
   * 时视口为 1360x1040，**覆盖整张地图** → 当前场景内默认裁剪接近 **no-op**；机制有效性由
   * `scripts/viewport-sample.mjs` 的 C 列（marginPx=0）证明。边距的收益出现在「世界远大于舞台」的场景。
   */
  viewport: {
    /** 舞台四周的预加载边距（像素），两侧各扩这么多：w = stageWidth + 2*marginPx */
    marginPx: 200,
    /** 裁剪 tick 间隔（帧）：每 N 帧做一次线性扫描（150 实体量级足够，不引入空间索引） */
    tickFrames: 5,
  },
  /**
   * S8 Task 5 远端插值（D6：只作用于远端实体，本地玩家保持即时）：
   * 广播只覆盖**插值目标**，由 `RemoteInterp.update` 每帧平滑逼近，消灭「10Hz 广播 → 位置跳变」。
   */
  remote: {
    /**
     * 平滑缓冲时长（毫秒）：`alpha = 1 - exp(-dtMs/bufferMs)`。默认 120ms ≈ 10Hz 广播的 1.2 个包间隔
     * （略大于一个间隔 → 追上目标的时间与下一包到达时间同量级，既不滞后太多也不抖）。
     * **设 0 即关闭插值**（收到广播直接到位 = 基线行为），供 A/B 对照与紧急回退使用。
     */
    interpBufferMs: 120,
    /**
     * 直接对齐阈值（像素）：目标距离超过该值时不插值、直接落到目标（计划风险 #5）。
     * 场景：实体离屏被视口裁剪**冻结更新**、或被长时间丢包后重新收到广播 —— 距离已远，
     * 缓慢爬过去会看到「幽灵位移」，直接对齐才是正确表现。默认 96px ≈ 常态单包位移（24px@10Hz）的 4 倍，
     * 不会在正常移动中误触发；low 档 5Hz 单包 ~48px 同样不触发。
     */
    snapPx: 96,
    /**
     * `remoteUpdateHz` 节流的**松弛比例**（D3-⑤ 的消费点）：生效间隔 = `1000/hz × 本值`。
     * 零松弛会与「服务端 10Hz 广播 + high 档 10Hz 节流」同频，因抖动**丢掉一半更新**（插值退化为 5Hz）；
     * 0.8 → high 档 80ms（常态零丢弃）、low 档 160ms（按预期丢弃一半，插值仍在平滑，不产生跳变）。
     */
    throttleSlackRatio: 0.8,
  },
};
