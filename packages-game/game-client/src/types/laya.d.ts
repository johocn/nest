/// <reference path="D:/Program Files/LayaAirIDE/resources/engine/types/LayaAir.d.ts" />

// LayaAirIDE 3.4.1 的 d.ts 漏声明 releaseRes（laya.core.js 运行时存在），本地补齐
declare namespace Laya {
  interface Loader {
    releaseRes(url: string): void;
  }
}
