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
  /** 就近交互半径（像素） */
  interactRadius: 120,
  /** 设备标识：后端 DTO 未标 @IsOptional，不传会 400（见 §1.2） */
  deviceId: 'laya2d-s1',
};