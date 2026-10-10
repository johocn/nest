import { Global, Module, OnModuleInit } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScoringService } from './scoring.service';
import { PlayerScoringState } from './entities/player-scoring-state.entity';
import { ScoringConfigEntity } from './entities/scoring-config.entity';
import { ScoringAdminService } from './scoring-admin.service';
import { ScoringAdminController } from './scoring-admin.controller';

/**
 * 全局评分模块：一次注册，全项目任意模块（对话/quiz/其他游戏）均可注入 ScoringService。
 * 配置入库 scoring_configs：模块初始化加载 is_active=true 行逐个注册（内置示例由
 * migration seeds 灌入）；admin CRUD 后即时热更新。config/*.ts 保留作单测 fixture 与类型来源。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PlayerScoringState, ScoringConfigEntity])],
  providers: [ScoringService, ScoringAdminService],
  controllers: [ScoringAdminController],
  exports: [ScoringService],
})
export class ScoringModule implements OnModuleInit {
  constructor(
    private readonly scoringService: ScoringService,
    @InjectRepository(ScoringConfigEntity)
    private readonly configRepo: Repository<ScoringConfigEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    const rows = await this.configRepo.find({ where: { isActive: true } });
    for (const row of rows) {
      if (row.config) this.scoringService.registerGame(row.config);
    }
  }
}
