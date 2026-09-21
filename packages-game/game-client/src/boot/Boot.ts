import { AppConfig } from '../config/AppConfig';

export class Boot {
  static async start(): Promise<void> {
    Laya.URL.basePath = AppConfig.assetBase;
    await Laya.init(AppConfig.stageWidth, AppConfig.stageHeight);
    Laya.stage.alignH = 'center';
    Laya.stage.alignV = 'middle';
    Laya.stage.scaleMode = Laya.Stage.SCALE_SHOWALL;
    Laya.stage.bgColor = '#101418';
    console.log(`[S1] boot ok, client=${AppConfig.clientVersion}`);
  }
}