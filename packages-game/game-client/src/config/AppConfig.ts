export const AppConfig = {
  /** 客户端版本（展示用） */
  clientVersion: '0.1.0-s1',
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
};