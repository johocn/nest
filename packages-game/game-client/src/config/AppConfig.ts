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
    panelMaxWidth: 640,
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
    optionHeight: 22,
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
    /** 蓝图行选中底色 */
    selectedBgColor: 'rgba(47,129,247,0.35)',
    /** 合法性红/绿 */
    legalColor: '#3fb950',
    illegalColor: '#ff7b72',
    /** 操作按钮行高与底色 */
    buttonHeight: 26,
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
};
