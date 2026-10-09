import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { historyTeachConfig } from './config/history-teach.config';
import { demoRpgConfig } from './config/demo-rpg.config';

/**
 * 全局评分模块：一次注册，全项目任意模块（对话/quiz/其他游戏）均可注入 ScoringService。
 * 内置两份示例配置，证明「一套引擎，多游戏复用」。各游戏也可自行 registerGame。
 */
@Global()
@Module({
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule implements OnModuleInit {
  constructor(private readonly scoringService: ScoringService) {}

  onModuleInit(): void {
    this.scoringService.registerGame(historyTeachConfig);
    this.scoringService.registerGame(demoRpgConfig);
  }
}
